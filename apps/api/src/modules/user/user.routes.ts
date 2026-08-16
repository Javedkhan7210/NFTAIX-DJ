import { Router } from "express";
import { Prisma } from "@prisma/client";
import { formatEther } from "viem";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/db/prisma.js";
import { requireAuth, AuthRequest } from "../auth/auth.middleware.js";
import {
  backfillPackageActivationTxFromChainEvents,
  syncPackageActivationFromRegistration
} from "../packages/registration-sync.service.js";
import { coalescedMirrorRewardsForDirectReferralActivations } from "../rewards/activation-reward-mirror.service.js";
import { logger } from "../../shared/logger.js";
import { todayTradingActiveByUserIds } from "./team-today-active.js";

function normalizeAddr(a: string): string {
  return a.trim().toLowerCase();
}

/** Count indexed marketplace Purchased events for any of the user’s linked wallets. */
async function countChainEventsForWallets(
  normalizedWallets: string[],
  kind: "purchased_buyer" | "listed_seller_unused"
): Promise<number> {
  if (normalizedWallets.length === 0) return 0;
  const addrList = Prisma.join(normalizedWallets.map((a) => Prisma.sql`${a}`));
  if (kind === "purchased_buyer") {
    const rows = await prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(*)::bigint AS c
      FROM "ChainEvent"
      WHERE "chainId" = ${env.CHAIN_ID}
        AND "eventName" = 'Purchased'
        AND LOWER(payload->>'buyer') IN (${addrList})
    `;
    return Number(rows[0]?.c ?? 0n);
  }
  // New stack Purchased has no previousOwner; sales counted as 0 until Listed+Transfer indexing.
  return 0;
}

async function loadOnChainSubscriptions(userId: string) {
  return prisma.packageActivation.findMany({
    where: { userId, onChain: true },
    orderBy: { activatedAt: "desc" },
    take: 50,
    include: { tier: true }
  });
}

/**
 * Indexer + registration sync can duplicate the same subscription:
 * - same `chainTxHash` → one card;
 * - duplicate tier with no tx hash → keep one row per tier (prefer rows that already have a tx hash).
 */
function dedupeSubscriptionHistoryRows<
  T extends { tierId: string; chainTxHash: string | null; activatedAt: Date }
>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime());
  const byTx = new Map<string, T>();
  for (const r of sorted) {
    const h = r.chainTxHash?.trim().toLowerCase();
    if (h && !byTx.has(h)) byTx.set(h, r);
  }
  const tierIdsWithTx = new Set([...byTx.values()].map((r) => r.tierId));
  const noTx = sorted.filter((r) => !r.chainTxHash?.trim());
  const byTierNoTx = new Map<string, T>();
  for (const r of noTx) {
    if (tierIdsWithTx.has(r.tierId)) continue;
    const prev = byTierNoTx.get(r.tierId);
    if (!prev || r.activatedAt > prev.activatedAt) byTierNoTx.set(r.tierId, r);
  }
  const merged = [...byTx.values(), ...byTierNoTx.values()];
  merged.sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime());
  return merged;
}

export const userRouter = Router();

userRouter.get("/profile", requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.sub },
    select: {
      id: true,
      publicUserNumber: true,
      email: true,
      referralCode: true,
      role: true,
      sponsorId: true,
      directReferralCount: true,
      teamCount: true,
      isActive: true,
      createdAt: true,
      custodialUsdtBalance: true,
      registrationTxHash: true,
      walletConnections: { where: { isPrimary: true } },
      packageActivations: {
        where: { isCurrent: true },
        take: 1,
        include: { tier: true }
      }
    }
  });
  res.json({
    ...user,
    /** Mirrors env: false = subscriptions/payments are on-chain only (no custodial DB credit). */
    custodialUsdtEnabled: env.CUSTODIAL_USDT_ENABLED
  });
});

/** Registration fee tx + indexed on-chain package activations (explorer links on the web app). */
userRouter.get("/blockchain-activity", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.sub;
  await backfillPackageActivationTxFromChainEvents(prisma, userId);
  /** Align DB with Registration.users on every load so a new activation appears without requiring an empty list first. */
  await syncPackageActivationFromRegistration(prisma, userId);
  await backfillPackageActivationTxFromChainEvents(prisma, userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { registrationTxHash: true }
  });
  /** Include on-chain rows even when the indexer never set `chainTxHash` (registration sync backfill). */
  let subscriptions = await loadOnChainSubscriptions(userId);
  subscriptions = dedupeSubscriptionHistoryRows(subscriptions);

  const wallets = await prisma.walletConnection.findMany({
    where: { userId },
    select: { walletAddress: true }
  });
  const addrSet = new Set(wallets.map((w) => normalizeAddr(w.walletAddress)));

  const buyRows = await prisma.chainEvent.findMany({
    where: { chainId: env.CHAIN_ID, eventName: "Purchased" },
    orderBy: [{ blockNumber: "desc" }],
    take: 400
  });

  type BuyPayload = { buyer?: string; tokenId?: string; price?: string };
  const nftPurchases = buyRows
    .filter((row) => {
      const p = row.payload as BuyPayload;
      return Boolean(p.buyer && addrSet.has(normalizeAddr(p.buyer)));
    })
    .slice(0, 50)
    .map((row) => {
      const p = row.payload as BuyPayload;
      let priceUsdt: string | null = null;
      try {
        if (p.price) priceUsdt = formatEther(BigInt(p.price));
      } catch {
        priceUsdt = null;
      }
      return {
        txHash: row.txHash,
        tokenId: p.tokenId ?? "",
        priceUsdt,
        blockNumber: row.blockNumber.toString()
      };
    });

  res.json({
    registrationTxHash: user?.registrationTxHash ?? null,
    subscriptions: subscriptions.map((a) => ({
      id: a.id,
      activatedAt: a.activatedAt,
      onChain: a.onChain,
      chainTxHash: a.chainTxHash,
      tierName: a.tier.name,
      tierAmount: a.tier.activationAmount
    })),
    nftPurchases
  });
});

/** Indexed buy/sell counts for linked wallets (no package sync). */
userRouter.get("/nft-trade-stats", requireAuth, async (req: AuthRequest, res) => {
  const wallets = await prisma.walletConnection.findMany({
    where: { userId: req.user!.sub },
    select: { walletAddress: true }
  });
  const walletList = [...new Set(wallets.map((w) => normalizeAddr(w.walletAddress)))];
  const [nftPurchaseCount, nftSaleCount] = await Promise.all([
    countChainEventsForWallets(walletList, "purchased_buyer"),
    countChainEventsForWallets(walletList, "listed_seller_unused")
  ]);
  res.json({ nftPurchaseCount, nftSaleCount });
});

userRouter.get("/team", requireAuth, async (req: AuthRequest, res) => {
  const edges = await prisma.referralEdge.findMany({
    where: { sponsorId: req.user!.sub },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  const uidSet = [...new Set(edges.map((e) => e.referralId))];
  const wallets =
    uidSet.length === 0
      ? []
      : await prisma.walletConnection.findMany({
          where: { userId: { in: uidSet }, isPrimary: true },
          select: { userId: true, walletAddress: true }
        });
  const walletByUser = new Map(wallets.map((w) => [w.userId, w.walletAddress]));

  const regRows =
    uidSet.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: uidSet } },
          select: { id: true, registrationTxHash: true }
        });
  const registrationByUserId = new Map(regRows.map((r) => [r.id, r.registrationTxHash]));

  const incomeAgg =
    uidSet.length === 0
      ? []
      : await prisma.incomeLedger.groupBy({
          by: ["sourceUserId"],
          where: { userId: req.user!.sub, sourceUserId: { in: uidSet } },
          _sum: { amount: true }
        });
  const revenueBySource = new Map(
    incomeAgg
      .filter((r) => r.sourceUserId)
      .map((r) => [r.sourceUserId as string, r._sum.amount?.toString() ?? "0"])
  );
  const todayActive = await todayTradingActiveByUserIds(prisma, uidSet);
  res.json({
    count: edges.length,
    edges: edges.map((e) => ({
      referralId: e.referralId,
      walletAddress: walletByUser.get(e.referralId) ?? null,
      registrationTxHash: registrationByUserId.get(e.referralId) ?? null,
      /** Amount earned by the current user from this referral (USDT). */
      earnedUsdt: revenueBySource.get(e.referralId) ?? "0",
      /** Back-compat for older clients. */
      revenueUsdt: revenueBySource.get(e.referralId) ?? "0",
      /** Today met required daily volume (50%); null = no package. Temporary status. */
      todayTradingActive: todayActive.get(e.referralId) ?? null,
      level: e.level,
      createdAt: e.createdAt
    }))
  });
});

userRouter.get("/referrals", requireAuth, async (req: AuthRequest, res) => {
  /** Backfill sponsor IncomeLedger when directs registered on-chain before indexer linked their wallet. */
  try {
    await coalescedMirrorRewardsForDirectReferralActivations(prisma, req.user!.sub, 200);
  } catch (e) {
    logger.warn(e, "user/referrals: direct referral income mirror failed — returning list anyway");
  }

  const directs = await prisma.user.findMany({
    where: { sponsorId: req.user!.sub },
    select: {
      id: true,
      directReferralCount: true,
      teamCount: true,
      createdAt: true,
      registrationTxHash: true,
      walletConnections: {
        orderBy: [{ isPrimary: "desc" }, { connectedAt: "asc" }],
        take: 1,
        select: { walletAddress: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });
  const uidSet = directs.map((u) => u.id);
  const incomeAggAll =
    uidSet.length === 0
      ? []
      : await prisma.incomeLedger.groupBy({
          by: ["sourceUserId"],
          where: { userId: req.user!.sub, sourceUserId: { in: uidSet } },
          _sum: { amount: true }
        });
  const earnedAllBySource = new Map(
    incomeAggAll
      .filter((r) => r.sourceUserId)
      .map((r) => [r.sourceUserId as string, r._sum.amount?.toString() ?? "0"])
  );

  // "My Direct" should show only direct referral commission from that user.
  const incomeAggDirect =
    uidSet.length === 0
      ? []
      : await prisma.incomeLedger.groupBy({
          by: ["sourceUserId"],
          where: { userId: req.user!.sub, sourceUserId: { in: uidSet }, incomeType: "direct" },
          _sum: { amount: true }
        });
  const earnedDirectBySource = new Map(
    incomeAggDirect
      .filter((r) => r.sourceUserId)
      .map((r) => [r.sourceUserId as string, r._sum.amount?.toString() ?? "0"])
  );

  // "Received" means unlocked (available/paid out).
  const incomeAggDirectReceived =
    uidSet.length === 0
      ? []
      : await prisma.incomeLedger.groupBy({
          by: ["sourceUserId"],
          where: {
            userId: req.user!.sub,
            sourceUserId: { in: uidSet },
            incomeType: "direct",
            status: "unlocked"
          },
          _sum: { amount: true }
        });
  const earnedDirectReceivedBySource = new Map(
    incomeAggDirectReceived
      .filter((r) => r.sourceUserId)
      .map((r) => [r.sourceUserId as string, r._sum.amount?.toString() ?? "0"])
  );
  const todayActive = await todayTradingActiveByUserIds(prisma, uidSet);
  res.json(
    directs.map((u) => ({
      ...u,
      /** Total amount earned by the current user from this user as a source (USDT). */
      earnedUsdt: earnedAllBySource.get(u.id) ?? "0",
      /** Direct referral commission earned from this user (USDT). */
      earnedDirectUsdt: earnedDirectBySource.get(u.id) ?? "0",
      /** Direct referral commission already received/unlocked from this user (USDT). */
      earnedDirectReceivedUsdt: earnedDirectReceivedBySource.get(u.id) ?? "0",
      /** Back-compat for older clients. */
      revenueUsdt: earnedAllBySource.get(u.id) ?? "0",
      /** Today met required daily volume (50%); null = no package. Temporary status. */
      todayTradingActive: todayActive.get(u.id) ?? null
    }))
  );
});

/**
 * Global team: users who joined after the current member (higher `publicUserNumber`).
 * Used for the “Global Team” roster; income from these sources is surfaced on the income screen.
 */
userRouter.get("/global-team", requireAuth, async (req: AuthRequest, res) => {
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.sub },
    select: { publicUserNumber: true }
  });
  const users = await prisma.user.findMany({
    where: { publicUserNumber: { gt: me.publicUserNumber } },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      id: true,
      createdAt: true,
      registrationTxHash: true,
      walletConnections: {
        where: { isPrimary: true },
        take: 1,
        select: { walletAddress: true }
      }
    }
  });
  const todayActive = await todayTradingActiveByUserIds(
    prisma,
    users.map((u) => u.id)
  );
  res.json(
    users.map((u) => ({
      ...u,
      todayTradingActive: todayActive.get(u.id) ?? null
    }))
  );
});
