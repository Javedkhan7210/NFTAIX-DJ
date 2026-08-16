import type { PackageActivation } from "@prisma/client";
import { getTradingPeriodBounds } from "./trading-period.js";

type ActivationScope = Pick<PackageActivation, "id" | "tradingVolumeSince">;

/** Volume counted toward package trading limit for the current activation. */
export function packageTradingLogWhere(userId: string, activation: ActivationScope) {
  const since = activation.tradingVolumeSince;
  return {
    userId,
    packageActivationId: activation.id,
    ...(since ? { tradeDate: { gte: since } } : {})
  };
}

/** Lower bound for daily volume (period start, per-user reset, global admin reset). */
export function resolveDailyVolumeGte(
  tradingVolumeSince: Date | null | undefined,
  now = new Date(),
  globalDailyVolumeSince?: Date | null,
  periodAnchor?: Date
): Date {
  const { periodStart } = getTradingPeriodBounds(now, periodAnchor);
  const ms = [
    periodStart.getTime(),
    tradingVolumeSince?.getTime(),
    globalDailyVolumeSince?.getTime()
  ].filter((t): t is number => t != null && Number.isFinite(t));
  return new Date(Math.max(...ms));
}

/** Volume counted toward the current trading period daily target (respects admin volume reset). */
export function userDayTradingLogWhere(
  userId: string,
  tradingVolumeSince: Date | null | undefined,
  now = new Date(),
  globalDailyVolumeSince?: Date | null,
  periodAnchor?: Date
) {
  const { periodEnd } = getTradingPeriodBounds(now, periodAnchor);
  const gte = resolveDailyVolumeGte(tradingVolumeSince, now, globalDailyVolumeSince, periodAnchor);
  return {
    userId,
    tradeDate: { gte, lt: periodEnd }
  };
}
