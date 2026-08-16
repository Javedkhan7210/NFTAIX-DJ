import { Prisma, type PrismaClient } from "@prisma/client";
import { env } from "../../shared/config/env.js";
import { effectiveActivationSponsorId, userIdForWallet } from "./on-chain-sponsor.js";
import { RewardEngineService } from "./reward-engine.service.js";
import { PACKAGE_USD_BY_ID } from "../packages/package-usd.js";

function normalizeAddr(a: string): string {
  return a.trim().toLowerCase();
}

/** Latest indexed `Activated` for this subscriber wallet (payload.user), if any. */
export async function findLatestActivatedTxForWallet(
  prisma: PrismaClient,
  walletAddress: string
): Promise<{ txHash: string } | null> {
  const w = normalizeAddr(walletAddress);
  const rows = await prisma.$queryRaw<{ txHash: string }[]>`
    SELECT "txHash" AS "txHash"
    FROM "ChainEvent"
    WHERE "chainId" = ${env.CHAIN_ID}
      AND "eventName" = 'Activated'
      AND LOWER(COALESCE("payload"->>'user', '')) = ${w}
    ORDER BY "blockNumber" DESC, "logIndex" DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** @deprecated Use findLatestActivatedTxForWallet — SubscribeEmit removed. */
export async function findLatestSubscribeEmitTxForWallet(
  prisma: PrismaClient,
  walletAddress: string
): Promise<{ txHash: string } | null> {
  return findLatestActivatedTxForWallet(prisma, walletAddress);
}

/** Latest `Activated` among any wallet linked to this user. */
export async function findLatestActivatedTxForUserWallets(
  prisma: PrismaClient,
  userId: string
): Promise<{ txHash: string } | null> {
  const wallets = await prisma.walletConnection.findMany({
    where: { userId },
    select: { walletAddress: true }
  });
  if (wallets.length === 0) return null;
  const addrs = wallets
    .map((w) => normalizeAddr(w.walletAddress))
    .filter((a) => /^0x[a-f0-9]{40}$/.test(a));
  if (addrs.length === 0) return null;

  const rows = await prisma.$queryRaw<{ txHash: string }[]>`
    SELECT "txHash" AS "txHash"
    FROM "ChainEvent"
    WHERE "chainId" = ${env.CHAIN_ID}
      AND "eventName" = 'Activated'
      AND LOWER(COALESCE("payload"->>'user', '')) IN (${Prisma.join(addrs)})
    ORDER BY "blockNumber" DESC, "logIndex" DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** @deprecated Use findLatestActivatedTxForUserWallets */
export async function findLatestSubscribeEmitTxForUserWallets(
  prisma: PrismaClient,
  userId: string
): Promise<{ txHash: string } | null> {
  return findLatestActivatedTxForUserWallets(prisma, userId);
}

/**
 * Writes `IncomeLedger` / `tokenDistributionLog` for an on-chain activation when the indexer
 * never ran `processActivationDistribution`. Idempotent via tokenDistributionLog.
 */
export async function tryMirrorActivationRewardsForActivation(
  prisma: PrismaClient,
  activationId: string
): Promise<{ ok: boolean; reason?: string }> {
  const pa = await prisma.packageActivation.findUnique({
    where: { id: activationId },
    include: { tier: true }
  });
  if (!pa?.onChain) return { ok: false, reason: "not_found_or_not_onchain" };

  const hasLog = await prisma.tokenDistributionLog.findFirst({
    where: { activationId },
    select: { id: true }
  });
  if (hasLog) return { ok: false, reason: "already_recorded" };

  let chainTxHash = pa.chainTxHash;
  if (!chainTxHash) {
    const hit = await findLatestActivatedTxForUserWallets(prisma, pa.userId);
    if (hit) {
      chainTxHash = hit.txHash;
      await prisma.packageActivation.update({
        where: { id: pa.id },
        data: { chainTxHash }
      });
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: pa.userId },
    select: { sponsorId: true }
  });

  let refUser: string | undefined;
  if (chainTxHash) {
    const ev = await prisma.chainEvent.findFirst({
      where: {
        txHash: chainTxHash,
        eventName: { in: ["Activated", "Registered", "Upgraded"] }
      },
      orderBy: { logIndex: "asc" }
    });
    const p = ev?.payload as { sponsor?: string; user?: string } | null;
    if (p?.sponsor) refUser = await userIdForWallet(prisma, String(p.sponsor));
  }

  const effectiveSponsor = effectiveActivationSponsorId(user?.sponsorId, refUser);
  const amt = Number(pa.tier.activationAmount);
  const rewardEngine = new RewardEngineService(prisma);
  try {
    await rewardEngine.processActivationDistribution(pa.userId, pa.id, amt, effectiveSponsor, {
      complianceAsOf: pa.activatedAt,
      incomeCapAsOf: pa.activatedAt
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Wallet signup stores `registrationTxHash` but may not create `PackageActivation`.
 * Backfills activation + sponsor mirror from Activated / registration hash.
 */
export async function ensureActivationFromRegistrationTx(
  prisma: PrismaClient,
  userId: string,
  registrationTxHash: string
): Promise<{ ok: boolean; reason?: string }> {
  const txHash = registrationTxHash.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    return { ok: false, reason: "invalid_tx" };
  }

  const existing = await prisma.packageActivation.findFirst({
    where: { userId, chainTxHash: txHash, onChain: true },
    select: { id: true }
  });
  if (existing) {
    return tryMirrorActivationRewardsForActivation(prisma, existing.id);
  }

  const onChainActs = await prisma.packageActivation.findMany({
    where: { userId, onChain: true },
    select: { id: true }
  });
  for (const a of onChainActs) {
    const hasLog = await prisma.tokenDistributionLog.findFirst({
      where: { activationId: a.id },
      select: { id: true }
    });
    if (!hasLog) {
      return tryMirrorActivationRewardsForActivation(prisma, a.id);
    }
  }

  const activatedEv = await prisma.chainEvent.findFirst({
    where: { txHash, eventName: "Activated" },
    orderBy: { logIndex: "asc" }
  });
  const payload = activatedEv?.payload as { packageId?: number | string } | null;
  const packageId = payload?.packageId != null ? Number(payload.packageId) : 1;
  const usd = PACKAGE_USD_BY_ID[packageId] ?? PACKAGE_USD_BY_ID[1];
  if (usd == null) return { ok: false, reason: "no_tier" };

  const tier = await prisma.packageTier.findFirst({
    where: { activationAmount: new Prisma.Decimal(usd), isActive: true },
    orderBy: { sortOrder: "asc" }
  });
  if (!tier) return { ok: false, reason: "no_tier" };

  const activationId = await prisma.$transaction(async (tx) => {
    await tx.packageActivation.updateMany({
      where: { userId, isCurrent: true },
      data: { isCurrent: false }
    });
    const created = await tx.packageActivation.create({
      data: {
        userId,
        tierId: tier.id,
        isCurrent: true,
        chainTxHash: txHash,
        onChain: true
      },
      select: { id: true }
    });
    return created.id;
  });

  return tryMirrorActivationRewardsForActivation(prisma, activationId);
}

/** Mirrors rewards for on-chain activations of direct referrals (sponsor income). */
export async function mirrorRewardsForDirectReferralActivations(
  prisma: PrismaClient,
  sponsorUserId: string,
  limit = 50
): Promise<void> {
  const directs = await prisma.user.findMany({
    where: { sponsorId: sponsorUserId },
    select: { id: true, registrationTxHash: true },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  if (directs.length === 0) return;

  for (const d of directs) {
    if (d.registrationTxHash) {
      await ensureActivationFromRegistrationTx(prisma, d.id, d.registrationTxHash);
    }

    const acts = await prisma.packageActivation.findMany({
      where: { userId: d.id, onChain: true },
      select: { id: true }
    });
    for (const a of acts) {
      await tryMirrorActivationRewardsForActivation(prisma, a.id);
    }
  }
}

/** Parallel `/income/*` calls share one mirror pass per user. */
const mirrorDirectReferralInflight = new Map<string, Promise<void>>();

export async function coalescedMirrorRewardsForDirectReferralActivations(
  prisma: PrismaClient,
  sponsorUserId: string,
  limit = 50
): Promise<void> {
  let p = mirrorDirectReferralInflight.get(sponsorUserId);
  if (!p) {
    p = mirrorRewardsForDirectReferralActivations(prisma, sponsorUserId, limit).finally(() => {
      mirrorDirectReferralInflight.delete(sponsorUserId);
    });
    mirrorDirectReferralInflight.set(sponsorUserId, p);
  }
  await p;
}
