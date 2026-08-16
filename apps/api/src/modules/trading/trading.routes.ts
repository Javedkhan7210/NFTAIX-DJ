import { Router } from "express";
import { Prisma } from "@prisma/client";
import { formatEther, formatUnits, maxUint256, parseAbi } from "viem";
import { z } from "zod";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/db/prisma.js";
import { requireAuth, requireFullAccess, AuthRequest } from "../auth/auth.middleware.js";
import { ChainIndexerService } from "../chain/chain-indexer.service.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { getDailyTradingMetrics } from "./trading-daily-metrics.js";
import { getDailyVolumeDivisor } from "./trading-divisor.js";
import { TradingComplianceService } from "./trading-compliance.service.js";
import {
  getGlobalDailyVolumeSince,
  getTradingPeriodBounds,
  getTradingPeriodHours,
  msUntilNextPeriodBoundary
} from "./trading-period.js";
import { userDayTradingLogWhere } from "./trading-volume-scope.js";
import { syncUserPackageIncomeMetrics } from "../income/package-income-metrics.service.js";
import { paginatedFromQuery, parseListQuery } from "../../shared/pagination.js";

const erc20AllowanceAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)"
]);
const mpBotReadAbi = parseAbi(["function botEnabled(address user) view returns (bool)"]);

const submitSchema = z.object({
  packageActivationId: z.string(),
  tradeDate: z.string().datetime(),
  volume: z.number().positive()
});

const botToggleSchema = z.object({
  enabled: z.boolean()
});

const service = new TradingComplianceService(prisma);
export const tradingRouter = Router();

function normalizeAddrForTrading(a: string): string {
  return a.trim().toLowerCase();
}

/** DB `Decimal(18,2)` vs `formatEther` can disagree slightly from wei rounding. */
const VOLUME_MATCH_EPS_USDT = 0.06;

function tradingVolumesCloseUSDT(dbVol: Prisma.Decimal, wei: bigint): boolean {
  const a = Number(dbVol);
  const b = Number(formatEther(wei));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= VOLUME_MATCH_EPS_USDT;
}

/** One volume row per on-chain purchase (indexer sync + backfill could duplicate). */
function dedupeTradingLogsByChainPurchase<
  T extends { id: string; chainTxHash: string | null; relatedTokenId: string | null }
>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const tx = r.chainTxHash?.trim().toLowerCase();
    const tid = r.relatedTokenId?.trim();
    const key = tx && tid ? `${tx}:${tid}` : `row:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Attach `chainTxHash` / `relatedTokenId` to legacy volume rows from indexed marketplace events. */
async function enrichTradingLogsChainTxFromChainEvents(
  userId: string,
  rows: Array<{
    id: string;
    tradeDate: Date;
    createdAt: Date;
    volume: Prisma.Decimal;
    chainTxHash: string | null;
    relatedTokenId: string | null;
  }>
): Promise<Map<string, { chainTxHash: string; relatedTokenId: string | null }>> {
  const resolved = new Map<string, { chainTxHash: string; relatedTokenId: string | null }>();
  const missing = rows
    .filter((r) => !r.chainTxHash?.trim())
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (missing.length === 0) return resolved;

  const wallets = await prisma.walletConnection.findMany({
    where: { userId },
    select: { walletAddress: true }
  });
  const walletSet = new Set(wallets.map((w) => normalizeAddrForTrading(w.walletAddress)));

  const oldestMs = Math.min(
    ...missing.map((r) => Math.min(new Date(r.tradeDate).getTime(), new Date(r.createdAt).getTime()))
  );
  const since = new Date(oldestMs - 14 * 24 * 60 * 60 * 1000);

  const events = await prisma.chainEvent.findMany({
    where: {
      chainId: env.CHAIN_ID,
      eventName: "Purchased",
      processedAt: { gte: since }
    },
    orderBy: [{ processedAt: "asc" }, { logIndex: "asc" }],
    take: 5000
  });

  const used = new Set<string>();
  const windowMs = 72 * 60 * 60 * 1000;

  for (const row of missing) {
    if (Number(row.volume) === 0) continue;
    const tradeT = new Date(row.tradeDate).getTime();
    const createdT = new Date(row.createdAt).getTime();

    for (const ce of events) {
      const key = `${ce.txHash}:${ce.logIndex}`;
      if (used.has(key)) continue;

      const p = ce.payload as Record<string, unknown>;
      const who =
        typeof p.buyer === "string" ? normalizeAddrForTrading(p.buyer as string) : null;
      if (!who || !walletSet.has(who)) continue;

      const weiRaw = p.price;
      if (weiRaw === undefined || weiRaw === null) continue;
      let wei: bigint;
      try {
        wei = BigInt(String(weiRaw));
      } catch {
        continue;
      }
      if (wei === 0n) continue;
      if (!tradingVolumesCloseUSDT(row.volume, wei)) continue;

      const procT = new Date(ce.processedAt).getTime();
      if (Math.abs(procT - createdT) > windowMs && Math.abs(procT - tradeT) > windowMs) {
        continue;
      }

      const rawTid = p.tokenId;
      const relatedTokenId =
        rawTid === undefined || rawTid === null ? null : String(rawTid).trim() || null;

      await prisma.tradingLog.update({
        where: { id: row.id },
        data: {
          chainTxHash: ce.txHash,
          ...(relatedTokenId ? { relatedTokenId } : {})
        }
      });
      used.add(key);
      resolved.set(row.id, { chainTxHash: ce.txHash, relatedTokenId });
      break;
    }
  }

  return resolved;
}

/** Avoid showing 77-digit `formatUnits(2^256-1)` in the app; "unlimited" approve is the common case. */
function formatUsdtAllowanceForUi(allowance: bigint, decimals: number): string {
  if (allowance >= maxUint256 - 1n) {
    return "Unlimited";
  }
  return formatUnits(allowance, decimals);
}

tradingRouter.get("/auto-trade-status", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  const usdt = env.USDT_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const dec = env.USDT_DECIMALS;
  const keeperExecutorConfigured = Boolean(env.AUTO_TRADE_EXECUTOR_PRIVATE_KEY?.trim());
  const tradingPeriodHours = getTradingPeriodHours();
  const keeperDailyUtcHour = env.AUTO_TRADE_KEEPER_UTC_HOUR;
  const keeperDailyUtcMinute = env.AUTO_TRADE_KEEPER_UTC_MINUTE;
  const keeperIntervalHours = env.AUTO_TRADE_KEEPER_INTERVAL_HOURS;
  const keeperScheduleSummary = `Every ${tradingPeriodHours} hours (daily limit resets on the same schedule; skips users who met period target)`;
  const keeperNextRunUtc = new Date(Date.now() + msUntilNextPeriodBoundary()).toISOString();

  if (!usdt || !mp) {
    return res.json({
      chainConfigured: false,
      hasPrimaryWallet: false,
      usdtAllowance: "0",
      autoTradeOnChain: false,
      botValidUntil: null as string | null,
      module: null as null,
      keeperExecutorConfigured,
      tradingPeriodHours,
      keeperDailyUtcHour,
      keeperDailyUtcMinute,
      keeperIntervalHours,
      keeperScheduleSummary,
      keeperNextRunUtc
    });
  }

  const wallet = await prisma.walletConnection.findFirst({
    where: { userId: req.user!.sub, isPrimary: true }
  });
  if (!wallet) {
    return res.json({
      chainConfigured: true,
      hasPrimaryWallet: false,
      usdtAllowance: "0",
      autoTradeOnChain: false,
      botValidUntil: null as string | null,
      module: null,
      keeperExecutorConfigured,
      tradingPeriodHours,
      keeperDailyUtcHour,
      keeperDailyUtcMinute,
      keeperIntervalHours,
      keeperScheduleSummary,
      keeperNextRunUtc
    });
  }

  const client = getPublicClient();
  const a = wallet.walletAddress as `0x${string}`;

  let usdtAllowance = "0";
  let autoTradeOnChain = false;
  let botValidUntil: string | null = null;

  if (mp) {
    const [allowance, botOn] = await Promise.all([
      client.readContract({
        address: usdt,
        abi: erc20AllowanceAbi,
        functionName: "allowance",
        args: [a, mp]
      }),
      client.readContract({
        address: mp,
        abi: mpBotReadAbi,
        functionName: "botEnabled",
        args: [a]
      })
    ]);

    usdtAllowance = formatUsdtAllowanceForUi(allowance, dec);
    autoTradeOnChain = Boolean(botOn);
    botValidUntil = null;
  }

  res.json({
    chainConfigured: true,
    hasPrimaryWallet: true,
    walletAddress: wallet.walletAddress,
    usdtAllowance,
    autoTradeOnChain,
    botValidUntil,
    module: null,
    keeperExecutorConfigured,
    tradingPeriodHours,
    keeperDailyUtcHour,
    keeperDailyUtcMinute,
    keeperIntervalHours,
    keeperScheduleSummary,
    keeperNextRunUtc
  });
});

tradingRouter.post("/submit", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  const body = submitSchema.parse(req.body);
  const activation = await prisma.packageActivation.findUniqueOrThrow({
    where: { id: body.packageActivationId },
    include: { tier: true }
  });
  const divisor = await getDailyVolumeDivisor(prisma);
  const allowedDailyVolume = Number(activation.tier.tradingLimit) / divisor;
  const tradeAt = new Date(body.tradeDate);
  await prisma.tradingLog.create({
    data: {
      userId: req.user!.sub,
      packageActivationId: activation.id,
      tradeDate: tradeAt,
      volume: body.volume,
      allowedDailyVolume
    }
  });
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { createdAt: true }
  });
  const periodAnchor = user?.createdAt;
  const globalDailySince = await getGlobalDailyVolumeSince(prisma);
  const { periodStart } = getTradingPeriodBounds(tradeAt, periodAnchor);
  const volSum = await prisma.tradingLog.aggregate({
    where: userDayTradingLogWhere(
      req.user!.sub,
      activation.tradingVolumeSince,
      tradeAt,
      globalDailySince,
      periodAnchor
    ),
    _sum: { volume: true }
  });
  const achievedForDay = Number(volSum._sum.volume ?? 0);
  const compliance = await service.evaluateDay(
    req.user!.sub,
    periodStart,
    allowedDailyVolume,
    achievedForDay,
    periodAnchor
  );
  try {
    await syncUserPackageIncomeMetrics(prisma, req.user!.sub);
  } catch {
    /* metrics sync is best-effort */
  }
  res.status(201).json(compliance);
});

tradingRouter.get("/compliance", requireAuth, async (req: AuthRequest, res) => {
  const uid = req.user!.sub;
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, {
    limit: 15,
    maxLimit: 50
  });
  const where = { userId: uid };
  const [rows, total] = await Promise.all([
    prisma.dailyTradingCompliance.findMany({
      where,
      orderBy: { day: "desc" },
      skip,
      take: limit
    }),
    prisma.dailyTradingCompliance.count({ where })
  ]);
  res.json(paginatedFromQuery(rows, total, page, limit));
});

/** Per-submission volume (same source as the market / submit pipeline). Shown in Trading History when daily compliance rows are missing or sparse. */
tradingRouter.get("/logs", requireAuth, async (req: AuthRequest, res) => {
  const uid = req.user!.sub;
  void new ChainIndexerService(prisma).ensureFreshUserMarketData(uid).catch((e) => {
    logger.warn(e, "trading/logs: ensureFreshUserMarketData");
  });
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, {
    limit: 20,
    maxLimit: 50
  });
  const logWhere = { userId: uid };
  const [rowsRaw, totalRaw] = await Promise.all([
    prisma.tradingLog.findMany({
      where: logWhere,
      orderBy: { tradeDate: "desc" },
      skip,
      take: limit + 20,
      include: {
        packageActivation: { include: { tier: { select: { name: true } } } }
      }
    }),
    prisma.tradingLog.count({ where: logWhere })
  ]);
  const rows = dedupeTradingLogsByChainPurchase(rowsRaw).slice(0, limit);
  const dupesOnPage = rowsRaw.length - rows.length;
  const total = Math.max(0, totalRaw - dupesOnPage);
  const enriched = await enrichTradingLogsChainTxFromChainEvents(
    req.user!.sub,
    rows.map((r) => ({
      id: r.id,
      tradeDate: r.tradeDate,
      createdAt: r.createdAt,
      volume: r.volume,
      chainTxHash: r.chainTxHash,
      relatedTokenId: r.relatedTokenId
    }))
  );

  const items = rows.map((r) => {
    const e = enriched.get(r.id);
    const chainTxHash = r.chainTxHash ?? e?.chainTxHash ?? null;
    return {
      id: r.id,
      tradeDate: r.tradeDate.toISOString(),
      volume: Number(r.volume),
      allowedDailyVolume: Number(r.allowedDailyVolume),
      tierName: r.packageActivation.tier.name,
      chainTxHash,
      relatedTokenId: r.relatedTokenId ?? null
    };
  });
  res.json(paginatedFromQuery(items, total, page, limit));
});

/** Aggregates subscription tier + trading usage for the Market dashboard (non-NFT tab). */
tradingRouter.patch("/bot", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  const { enabled } = botToggleSchema.parse(req.body);
  if (!enabled) {
    const current = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { autoTradeBotEnabled: true }
    });
    if (current?.autoTradeBotEnabled) {
      return res.status(409).json({ message: "Auto trade cannot be disabled once enabled." });
    }
  }
  await prisma.user.update({
    where: { id: req.user!.sub },
    data: { autoTradeBotEnabled: enabled }
  });
  res.json({ enabled });
});

tradingRouter.get("/dashboard", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.sub;
  const userFlags = await prisma.user.findUnique({
    where: { id: userId },
    select: { autoTradeBotEnabled: true, createdAt: true }
  });
  const currentActivation = await prisma.packageActivation.findFirst({
    where: { userId, isCurrent: true },
    include: { tier: true }
  });

  const now = new Date();
  const periodAnchor = userFlags?.createdAt;
  const { periodStart, periodEnd, periodKey } = getTradingPeriodBounds(now, periodAnchor);
  const tradingPeriodHours = getTradingPeriodHours();

  const dailyMetrics = await getDailyTradingMetrics(prisma, userId, currentActivation, now);
  const tradingLimit = dailyMetrics.tradingLimit;
  const activationAmount = currentActivation ? Number(currentActivation.tier.activationAmount) : 0;
  const dailyAllowance = dailyMetrics.dailyAllowance;
  /** Period volume + remaining cap (resets every TRADING_PERIOD_HOURS). */
  const totalTradedVolume = dailyMetrics.periodTradedVolume;
  const remainingTradingLimit = dailyMetrics.remainingDailyLimit;
  const todayLoggedVolume = dailyMetrics.periodTradedVolume;

  const todayCompliance = await prisma.dailyTradingCompliance.findFirst({
    where: {
      userId,
      day: periodKey
    }
  });

  const requiredToday = todayCompliance
    ? Number(todayCompliance.requiredVolume)
    : dailyAllowance;
  const showTodayBlock = currentActivation && (requiredToday > 0 || todayLoggedVolume > 0);

  res.json({
    autoTradeBotEnabled: userFlags?.autoTradeBotEnabled ?? false,
    currentTier: currentActivation
      ? {
          id: currentActivation.tier.id,
          name: currentActivation.tier.name,
          activationAmount,
          tradingLimit,
          dailyAllowance
        }
      : null,
    totalTradedVolume,
    remainingTradingLimit,
    tradingPeriodHours,
    periodEndsAt: periodEnd.toISOString(),
    todayCompliance: showTodayBlock
      ? {
          day: periodStart.toISOString(),
          periodEndsAt: periodEnd.toISOString(),
          requiredVolume: requiredToday,
          achievedVolume: todayLoggedVolume,
          status:
            todayCompliance?.status ??
            (requiredToday <= 0
              ? "inactive"
              : todayLoggedVolume >= requiredToday
                ? "compliant"
                : "non_compliant")
        }
      : null
  });
});
