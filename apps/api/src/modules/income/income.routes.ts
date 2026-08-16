import { Router } from "express";
import { IncomeType } from "@prisma/client";
import { prisma } from "../../shared/db/prisma.js";
import { requireAuth, AuthRequest } from "../auth/auth.middleware.js";
import { coalescedMirrorRewardsForDirectReferralActivations } from "../rewards/activation-reward-mirror.service.js";
import { sumInboundUsdtToWallet } from "./chain-usdt-inbound.service.js";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";
import { syncUserPackageIncomeMetrics } from "./package-income-metrics.service.js";
import { ChainIndexerService } from "../chain/chain-indexer.service.js";

const chainIndexer = new ChainIndexerService(prisma);

export const incomeRouter = Router();

/** Income responses are user-specific; avoid browser/CDN 304 caching stale JSON (especially totals). */
incomeRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

function utcDayBounds(d: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return { dayStart, dayEnd };
}

/** Prisma `Decimal` does not JSON-serialize to a numeric string; clients see `{}` and parse amounts as 0. */
function incomeLedgerWalletJson(i: {
  id: string;
  userId: string;
  sourceUserId: string | null;
  incomeType: string;
  amount: { toString(): string };
  status: string;
  lockedUntil: Date;
  createdAt: Date;
}) {
  return {
    id: i.id,
    userId: i.userId,
    sourceUserId: i.sourceUserId,
    incomeType: i.incomeType,
    amount: i.amount.toString(),
    status: i.status,
    lockedUntil: i.lockedUntil,
    createdAt: i.createdAt
  };
}

incomeRouter.get("/wallet", requireAuth, async (req: AuthRequest, res) => {
  await coalescedMirrorRewardsForDirectReferralActivations(prisma, req.user!.sub, 80);

  const primaryWallet = await prisma.walletConnection.findFirst({
    where: { userId: req.user!.sub, isPrimary: true },
    select: { walletAddress: true }
  });

  const timeoutMs = env.INCOME_WALLET_CHAIN_INBOUND_TIMEOUT_MS;
  const addr = primaryWallet?.walletAddress?.trim();
  const chainScan =
    addr != null && addr.length > 0 ? sumInboundUsdtToWallet(addr) : Promise.resolve(null);

  const [incomes, chainInbound] = await Promise.all([
    prisma.incomeLedger.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" }
    }),
    timeoutMs > 0
      ? Promise.race([
          chainScan,
          new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), timeoutMs);
          })
        ])
      : chainScan
  ]);

  const locked = incomes.filter((i) => i.status === "locked");
  const unlocked = incomes.filter((i) => i.status === "unlocked");
  const burned = incomes.filter((i) => i.status === "burned");
  const sumAmt = (rows: typeof incomes) =>
    rows.reduce((s, i) => s + Number(i.amount), 0);
  const now = Date.now();
  const futureUnlockTimes = locked
    .filter((i) => new Date(i.lockedUntil).getTime() > now)
    .map((i) => new Date(i.lockedUntil).getTime());
  const nextIncomeUnlockAt =
    futureUnlockTimes.length > 0 ? new Date(Math.min(...futureUnlockTimes)).toISOString() : null;

  res.json({
    locked: locked.map(incomeLedgerWalletJson),
    unlocked: unlocked.map(incomeLedgerWalletJson),
    burned: burned.map(incomeLedgerWalletJson),
    total: incomes.map(incomeLedgerWalletJson),
    summary: {
      unlockedTotal: sumAmt(unlocked),
      lockedTotal: sumAmt(locked),
      burnedTotal: sumAmt(burned),
      nextIncomeUnlockAt,
      /** Sum of non-burned ledger rows (subscription / rank pool mirror — not all on-chain payouts). */
      ledgerEarnedTotal: sumAmt(incomes.filter((i) => i.status !== "burned")),
      /** Approximate USDT received on-chain to primary wallet over recent blocks (see env lookback). */
      chainInboundUsdtApprox: chainInbound?.approxTotal ?? null,
      chainInboundScan: chainInbound
        ? { fromBlock: chainInbound.fromBlock.toString(), toBlock: chainInbound.toBlock.toString() }
        : null
    }
  });
});

/**
 * Marketplace seller trading income: max of (1) non-burned `IncomeLedger` `nft` rows and (2) indexed
 * `NftSaleTradingIncome` (same tx as ledger grant). Ledger can be empty when the full amount was routed
 * to daily-cap burn, so the resale audit table keeps the UI honest.
 */
incomeRouter.get("/nft-extra-earned", requireAuth, async (req: AuthRequest, res) => {
  try {
    await coalescedMirrorRewardsForDirectReferralActivations(prisma, req.user!.sub, 80);
    const now = new Date();
    const { dayStart, dayEnd } = utcDayBounds(now);

    const [ledgerTotal, ledgerToday, saleTotal, saleToday] = await Promise.all([
      prisma.incomeLedger.aggregate({
        where: {
          userId: req.user!.sub,
          incomeType: IncomeType.nft,
          status: { not: "burned" }
        },
        _sum: { amount: true }
      }),
      prisma.incomeLedger.aggregate({
        where: {
          userId: req.user!.sub,
          incomeType: IncomeType.nft,
          status: { not: "burned" },
          createdAt: { gte: dayStart, lt: dayEnd }
        },
        _sum: { amount: true }
      }),
      prisma.nftSaleTradingIncome.aggregate({
        where: { sellerUserId: req.user!.sub },
        _sum: { tradingIncomeUsdt: true }
      }),
      prisma.nftSaleTradingIncome.aggregate({
        where: { sellerUserId: req.user!.sub, createdAt: { gte: dayStart, lt: dayEnd } },
        _sum: { tradingIncomeUsdt: true }
      })
    ]);

    const fromLedger = Number(ledgerTotal._sum.amount ?? 0);
    const fromSales = Number(saleTotal._sum.tradingIncomeUsdt ?? 0);
    const fromLedgerToday = Number(ledgerToday._sum.amount ?? 0);
    const fromSalesToday = Number(saleToday._sum.tradingIncomeUsdt ?? 0);

    return res.json({
      extraEarned: Math.max(fromLedger, fromSales),
      todayExtraEarned: Math.max(fromLedgerToday, fromSalesToday),
      source: "ledger_or_resale_audit"
    });
  } catch (e) {
    logger.warn(e, "income/nft-extra-earned: ledger aggregate failed");
    return res.json({
      extraEarned: 0,
      todayExtraEarned: 0,
      error: "ledger_read_failed"
    });
  }
});

/**
 * Direct / sublevel / marketplace trading totals from `IncomeLedger` (same rows as `/income/wallet`),
 * not live Registration `eth_getLogs`. Avoids 504s from scanning 100k+ blocks on each Income page load.
 * Trading (`incomeType = nft`) is max(ledger, `NftSaleTradingIncome`) so capped/burned grants still show
 * the resale-attributed amount the indexer recorded.
 */
incomeRouter.get("/nft-level-income-summary", requireAuth, async (req: AuthRequest, res) => {
  try {
    void chainIndexer.backfillNftSaleLevelIncomeForUser(req.user!.sub, 600).catch((e) => {
      logger.warn(e, "income/nft-level-income-summary: backfill failed");
    });
    const now = new Date();
    const { dayStart, dayEnd } = utcDayBounds(now);
    const [total, today] = await Promise.all([
      prisma.nftSaleLevelIncome.aggregate({
        where: { recipientUserId: req.user!.sub },
        _sum: { amountUsdt: true }
      }),
      prisma.nftSaleLevelIncome.aggregate({
        where: { recipientUserId: req.user!.sub, createdAt: { gte: dayStart, lt: dayEnd } },
        _sum: { amountUsdt: true }
      })
    ]);
    return res.json({
      nftLevelIncome: Number(total._sum.amountUsdt ?? 0),
      todayNftLevelIncome: Number(today._sum.amountUsdt ?? 0),
      source: "nft_sale_level_income"
    });
  } catch (e) {
    logger.warn(e, "income/nft-level-income-summary failed");
    return res.json({ nftLevelIncome: 0, todayNftLevelIncome: 0, error: "read_failed" });
  }
});

incomeRouter.get("/registration-reward-summary", requireAuth, async (req: AuthRequest, res) => {
  const registration = env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}` | undefined;

  try {
    void chainIndexer.backfillNftSaleLevelIncomeForUser(req.user!.sub, 600).catch((e) => {
      logger.warn(e, "income/registration-reward-summary: nft level backfill failed");
    });
    await coalescedMirrorRewardsForDirectReferralActivations(prisma, req.user!.sub, 80);
    const now = new Date();
    const { dayStart, dayEnd } = utcDayBounds(now);
    const sublevelTypes = [IncomeType.team, IncomeType.network, IncomeType.level] as const;
    const nftTradingWhere = {
      userId: req.user!.sub,
      incomeType: IncomeType.nft,
      status: { not: "burned" as const }
    };

    const [
      directTotal,
      subTotal,
      directToday,
      subToday,
      tradingLedgerTotal,
      tradingLedgerToday,
      tradingSaleTotal,
      tradingSaleToday,
      tradingLogVolumeTotal,
      tradingLogVolumeToday,
      nftLevelTotal,
      nftLevelToday
    ] = await Promise.all([
      prisma.incomeLedger.aggregate({
        where: {
          userId: req.user!.sub,
          incomeType: IncomeType.direct,
          status: { not: "burned" }
        },
        _sum: { amount: true }
      }),
      prisma.incomeLedger.aggregate({
        where: {
          userId: req.user!.sub,
          incomeType: { in: [...sublevelTypes] },
          status: { not: "burned" }
        },
        _sum: { amount: true }
      }),
      prisma.incomeLedger.aggregate({
        where: {
          userId: req.user!.sub,
          incomeType: IncomeType.direct,
          status: { not: "burned" },
          createdAt: { gte: dayStart, lt: dayEnd }
        },
        _sum: { amount: true }
      }),
      prisma.incomeLedger.aggregate({
        where: {
          userId: req.user!.sub,
          incomeType: { in: [...sublevelTypes] },
          status: { not: "burned" },
          createdAt: { gte: dayStart, lt: dayEnd }
        },
        _sum: { amount: true }
      }),
      prisma.incomeLedger.aggregate({
        where: nftTradingWhere,
        _sum: { amount: true }
      }),
      prisma.incomeLedger.aggregate({
        where: { ...nftTradingWhere, createdAt: { gte: dayStart, lt: dayEnd } },
        _sum: { amount: true }
      }),
      prisma.nftSaleTradingIncome.aggregate({
        where: { sellerUserId: req.user!.sub },
        _sum: { tradingIncomeUsdt: true }
      }),
      prisma.nftSaleTradingIncome.aggregate({
        where: { sellerUserId: req.user!.sub, createdAt: { gte: dayStart, lt: dayEnd } },
        _sum: { tradingIncomeUsdt: true }
      }),
      prisma.tradingLog.aggregate({
        where: { userId: req.user!.sub },
        _sum: { volume: true }
      }),
      prisma.tradingLog.aggregate({
        where: { userId: req.user!.sub, tradeDate: { gte: dayStart, lt: dayEnd } },
        _sum: { volume: true }
      }),
      prisma.nftSaleLevelIncome.aggregate({
        where: { recipientUserId: req.user!.sub },
        _sum: { amountUsdt: true }
      }),
      prisma.nftSaleLevelIncome.aggregate({
        where: { recipientUserId: req.user!.sub, createdAt: { gte: dayStart, lt: dayEnd } },
        _sum: { amountUsdt: true }
      })
    ]);

    const fromLedgerNft = Number(tradingLedgerTotal._sum.amount ?? 0);
    const fromSaleAudit = Number(tradingSaleTotal._sum.tradingIncomeUsdt ?? 0);
    const tradingIncome = Math.max(fromLedgerNft, fromSaleAudit);
    const todayTradingIncome = Math.max(
      Number(tradingLedgerToday._sum.amount ?? 0),
      Number(tradingSaleToday._sum.tradingIncomeUsdt ?? 0)
    );
    const packageTradingVolumeUsdt = Number(tradingLogVolumeTotal._sum.volume ?? 0);
    const todayPackageTradingVolumeUsdt = Number(tradingLogVolumeToday._sum.volume ?? 0);
    const nftLevelIncome = Number(nftLevelTotal._sum.amountUsdt ?? 0);
    const todayNftLevelIncome = Number(nftLevelToday._sum.amountUsdt ?? 0);

    const directIncomeUsdt = Number(directTotal._sum.amount ?? 0);

    let holdNftAmountUsdt = 0;
    let totalSpentUsdt = 0;
    let incomeFromPackageUsdt = 0;
    let tradingIncomeFromPackageUsdt = 0;
    let currentPackageActivationUsdt = 0;
    let tokenAirdropScore = 0;

    try {
      /** Stale-while-revalidate: `syncUserPackageIncomeMetrics` can RPC per held NFT; return DB cache immediately when present. */
      const [cachedMetrics, currentActivation] = await Promise.all([
        prisma.userPackageIncomeMetrics.findUnique({
          where: { userId: req.user!.sub },
          select: {
            holdNftAmountUsdt: true,
            totalSpentUsdt: true,
            incomeUsdt: true,
            tradingIncomeDerivedUsdt: true
          }
        }),
        prisma.packageActivation.findFirst({
          where: { userId: req.user!.sub, isCurrent: true },
          include: { tier: { select: { activationAmount: true } } }
        })
      ]);

      if (cachedMetrics) {
        holdNftAmountUsdt = Number(cachedMetrics.holdNftAmountUsdt);
        totalSpentUsdt = Number(cachedMetrics.totalSpentUsdt);
        incomeFromPackageUsdt = Number(cachedMetrics.incomeUsdt);
        tradingIncomeFromPackageUsdt = Number(cachedMetrics.tradingIncomeDerivedUsdt);
        void syncUserPackageIncomeMetrics(prisma, req.user!.sub).catch((e) => {
          logger.warn(e, "income/registration-reward-summary: background package metrics refresh failed");
        });
      } else {
        const metricsSnap = await syncUserPackageIncomeMetrics(prisma, req.user!.sub).catch((e) => {
          logger.warn(e, "income/registration-reward-summary: package income metrics sync failed");
          return null;
        });
        if (metricsSnap) {
          holdNftAmountUsdt = metricsSnap.holdNftAmountUsdt;
          totalSpentUsdt = metricsSnap.totalSpentUsdt;
          incomeFromPackageUsdt = metricsSnap.incomeFromPackageUsdt;
          tradingIncomeFromPackageUsdt = metricsSnap.tradingIncomeFromPackageUsdt;
        }
      }

      currentPackageActivationUsdt = Number(currentActivation?.tier.activationAmount ?? 0);
      tokenAirdropScore = 2 * currentPackageActivationUsdt + directIncomeUsdt;
    } catch (e) {
      logger.warn(e, "income/registration-reward-summary: activation / metrics bundle failed");
    }

    if (!registration) {
      return res.json({
        directIncome: 0,
        sublevelIncome: 0,
        todayDirectIncome: 0,
        todaySublevelIncome: 0,
        nftLevelIncome,
        todayNftLevelIncome,
        tradingIncome,
        todayTradingIncome,
        packageTradingVolumeUsdt,
        todayPackageTradingVolumeUsdt,
        holdNftAmountUsdt,
        totalSpentUsdt,
        incomeFromPackageUsdt,
        tradingIncomeFromPackageUsdt,
        currentPackageActivationUsdt,
        tokenAirdropScore,
        source: "ledger"
      });
    }

    return res.json({
      directIncome: Number(directTotal._sum.amount ?? 0),
      sublevelIncome: Number(subTotal._sum.amount ?? 0),
      todayDirectIncome: Number(directToday._sum.amount ?? 0),
      todaySublevelIncome: Number(subToday._sum.amount ?? 0),
      nftLevelIncome,
      todayNftLevelIncome,
      tradingIncome,
      todayTradingIncome,
      packageTradingVolumeUsdt,
      todayPackageTradingVolumeUsdt,
      holdNftAmountUsdt,
      totalSpentUsdt,
      incomeFromPackageUsdt,
      tradingIncomeFromPackageUsdt,
      currentPackageActivationUsdt,
      tokenAirdropScore,
      source: "ledger"
    });
  } catch (e) {
    logger.warn(e, "income/registration-reward-summary: ledger aggregate failed");
    return res.json({
      directIncome: 0,
      sublevelIncome: 0,
      todayDirectIncome: 0,
      todaySublevelIncome: 0,
      nftLevelIncome: 0,
      todayNftLevelIncome: 0,
      tradingIncome: 0,
      todayTradingIncome: 0,
      packageTradingVolumeUsdt: 0,
      todayPackageTradingVolumeUsdt: 0,
      holdNftAmountUsdt: 0,
      totalSpentUsdt: 0,
      incomeFromPackageUsdt: 0,
      tradingIncomeFromPackageUsdt: 0,
      currentPackageActivationUsdt: 0,
      tokenAirdropScore: 0,
      error: "ledger_read_failed"
    });
  }
});

incomeRouter.get("/history", requireAuth, async (req: AuthRequest, res) => {
  void chainIndexer.backfillNftSaleLevelIncomeForUser(req.user!.sub, 600).catch((e) => {
    logger.warn(e, "income/history: nft level backfill failed");
  });
  /** Same mirror as `/wallet` + `/registration-reward-summary` so history filters match overview totals. */
  await coalescedMirrorRewardsForDirectReferralActivations(prisma, req.user!.sub, 80);

  const [rows, nftLevelRows] = await Promise.all([
    prisma.incomeLedger.findMany({
      where: { userId: req.user!.sub },
      include: { logs: { orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "desc" },
      take: 200
    }),
    prisma.nftSaleLevelIncome.findMany({
      where: { recipientUserId: req.user!.sub },
      orderBy: { createdAt: "desc" },
      take: 200
    })
  ]);
  const sourceIds = [...new Set(rows.map((r) => r.sourceUserId).filter(Boolean))] as string[];
  const sources =
    sourceIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, publicUserNumber: true, referralCode: true }
        })
      : [];
  const srcById = new Map(sources.map((u) => [u.id, u]));

  // IncomeLedger rows are a UI mirror of on-chain rewards; attach the source user's latest on-chain activation tx hash (if any).
  const activations =
    sourceIds.length > 0
      ? await prisma.packageActivation.findMany({
          where: { userId: { in: sourceIds }, onChain: true, chainTxHash: { not: null } },
          orderBy: { activatedAt: "desc" },
          select: { userId: true, chainTxHash: true, activatedAt: true }
        })
      : [];
  const srcTxByUserId = new Map<string, string>();
  for (const a of activations) {
    if (!a.chainTxHash) continue;
    if (!srcTxByUserId.has(a.userId)) srcTxByUserId.set(a.userId, a.chainTxHash);
  }

  const ledgerHistory = rows.map((r) => {
    const src = r.sourceUserId ? srcById.get(r.sourceUserId) : undefined;
    const sourceActivationTxHash = r.sourceUserId ? srcTxByUserId.get(r.sourceUserId) ?? null : null;
    return {
      id: r.id,
      historyKind: "ledger" as const,
      createdAt: r.createdAt.toISOString(),
      amount: r.amount.toString(),
      status: r.status,
      incomeType: r.incomeType,
      sourcePublicNumber: src?.publicUserNumber ?? null,
      sourceReferralCode: src?.referralCode ?? null,
      sourceActivationTxHash,
      txHash: r.chainTxHash ?? null,
      tokenId: null as string | null,
      treeLine: null as number | null
    };
  });

  const nftLevelHistory = nftLevelRows.map((r: (typeof nftLevelRows)[number]) => ({
    id: r.id,
    historyKind: "nft_level" as const,
    createdAt: r.createdAt.toISOString(),
    amount: r.amountUsdt.toString(),
    status: "unlocked",
    incomeType: "nft_level",
    sourcePublicNumber: null,
    sourceReferralCode: null,
    sourceActivationTxHash: null,
    txHash: r.txHash,
    tokenId: r.tokenId,
    treeLine: r.treeLine
  }));

  const merged = [...ledgerHistory, ...nftLevelHistory].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  res.json(merged.slice(0, 200));
});
