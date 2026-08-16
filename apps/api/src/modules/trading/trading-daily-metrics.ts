import type { PackageActivation, PrismaClient } from "@prisma/client";
import { getDailyVolumeDivisor } from "./trading-divisor.js";
import { getGlobalDailyVolumeSince } from "./trading-period.js";
import { userDayTradingLogWhere } from "./trading-volume-scope.js";

type ActivationWithTier = PackageActivation & {
  tier: { tradingLimit: unknown };
};

/** Tier `tradingLimit` is the per-period (daily) cap; it resets every TRADING_PERIOD_HOURS. */
export async function getDailyTradingMetrics(
  prisma: Pick<PrismaClient, "tradingLog" | "rewardSetting" | "user">,
  userId: string,
  activation: ActivationWithTier | null | undefined,
  now = new Date()
) {
  if (!activation) {
    return {
      tradingLimit: 0,
      dailyAllowance: 0,
      periodTradedVolume: 0,
      remainingDailyLimit: 0
    };
  }

  const tradingLimit = Number(activation.tier.tradingLimit);
  const divisor = await getDailyVolumeDivisor(prisma);
  const dailyAllowance = tradingLimit / divisor;
  const globalDailySince = await getGlobalDailyVolumeSince(prisma);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true }
  });
  const periodAnchor = user?.createdAt;
  const volSum = await prisma.tradingLog.aggregate({
    where: userDayTradingLogWhere(
      userId,
      activation.tradingVolumeSince,
      now,
      globalDailySince,
      periodAnchor
    ),
    _sum: { volume: true }
  });
  const periodTradedVolume = Number(volSum._sum.volume ?? 0);
  const remainingDailyLimit = Math.max(0, dailyAllowance - periodTradedVolume);

  return {
    tradingLimit,
    dailyAllowance,
    periodTradedVolume,
    remainingDailyLimit
  };
}
