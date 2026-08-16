import { prisma } from "../../shared/db/prisma.js";
import { syncUserPackageIncomeMetrics } from "../income/package-income-metrics.service.js";
import { getDailyTradingMetrics } from "../trading/trading-daily-metrics.js";
import { getTradingPeriodBounds } from "../trading/trading-period.js";

export type ResetUserTradingLimitResult = {
  packageActivationId: string;
  deletedLogs: number;
  deletedCompliance: number;
  previousPackageVolume: number;
  previousTodayVolume: number;
  packageTradingLimit: number;
  dailyAllowance: number;
};

/**
 * Resets the user's daily trading allowance for the current period (tier tradingLimit per period).
 * Sets `tradingVolumeSince` so earlier trades in this period no longer count. Does not delete log rows.
 */
export async function resetUserTradingLimit(userId: string): Promise<ResetUserTradingLimitResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, createdAt: true }
  });
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const activation = await prisma.packageActivation.findFirst({
    where: { userId, isCurrent: true },
    include: { tier: true }
  });
  if (!activation) {
    throw Object.assign(new Error("User has no active package — grant a tier in Admin first."), { status: 400 });
  }

  const before = await getDailyTradingMetrics(prisma, userId, activation);
  const packageTradingLimit = before.tradingLimit;
  const dailyAllowance = before.dailyAllowance;
  const previousTodayVolume = before.periodTradedVolume;
  const previousPackageVolume = previousTodayVolume;

  const { periodKey } = getTradingPeriodBounds(new Date(), user.createdAt);
  const resetAt = new Date();

  const complianceDelete = await prisma.dailyTradingCompliance.deleteMany({
    where: { userId, day: periodKey }
  });

  await prisma.packageActivation.update({
    where: { id: activation.id },
    data: { tradingVolumeSince: resetAt }
  });

  try {
    await syncUserPackageIncomeMetrics(prisma, userId);
  } catch {
    /* best-effort */
  }

  return {
    packageActivationId: activation.id,
    deletedLogs: 0,
    deletedCompliance: complianceDelete.count,
    previousPackageVolume,
    previousTodayVolume,
    packageTradingLimit,
    dailyAllowance
  };
}
