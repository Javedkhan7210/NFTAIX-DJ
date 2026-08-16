import type { PrismaClient } from "@prisma/client";
import { env } from "../../shared/config/env.js";

/** When set (ISO), daily volume counts only trades at or after this time (all users). */
export const GLOBAL_DAILY_VOLUME_SINCE_KEY = "trading.globalDailyVolumeSince";

/** Rolling window length for daily trading allowance + auto-trade bot cadence. */
export function getTradingPeriodHours(): number {
  return env.TRADING_PERIOD_HOURS;
}

export function getTradingPeriodMs(): number {
  return getTradingPeriodHours() * 60 * 60 * 1000;
}

/**
 * Trading period boundaries.
 * With `periodAnchor` (user `createdAt`), windows roll from join time — e.g. join at 02:58:20 resets every
 * `TRADING_PERIOD_HOURS` on that cadence. Without anchor, uses epoch-aligned windows (global admin / cron).
 */
export function getTradingPeriodBounds(at = new Date(), periodAnchor?: Date) {
  const ms = getTradingPeriodMs();
  const t = at.getTime();
  if (periodAnchor) {
    const anchorMs = periodAnchor.getTime();
    if (t < anchorMs) {
      const periodStart = periodAnchor;
      return { periodStart, periodEnd: new Date(anchorMs + ms), periodKey: periodStart };
    }
    const periodIndex = Math.floor((t - anchorMs) / ms);
    const periodStartMs = anchorMs + periodIndex * ms;
    const periodStart = new Date(periodStartMs);
    const periodEnd = new Date(periodStartMs + ms);
    return { periodStart, periodEnd, periodKey: periodStart };
  }
  const periodStartMs = Math.floor(t / ms) * ms;
  const periodStart = new Date(periodStartMs);
  const periodEnd = new Date(periodStartMs + ms);
  return { periodStart, periodEnd, periodKey: periodStart };
}

export function msUntilNextPeriodBoundary(at = new Date()): number {
  const { periodEnd } = getTradingPeriodBounds(at);
  return Math.max(0, periodEnd.getTime() - at.getTime());
}

/** Trading period immediately before `at` (same anchor rules as `getTradingPeriodBounds`). */
export function getPreviousTradingPeriodBounds(at = new Date(), periodAnchor?: Date) {
  const { periodStart } = getTradingPeriodBounds(at, periodAnchor);
  const prevAt = new Date(periodStart.getTime() - 1);
  return getTradingPeriodBounds(prevAt, periodAnchor);
}

/** Whether `tradeDate` falls in the same period as `now` (per-user when `periodAnchor` is set). */
export function isTradeDateInCurrentPeriod(
  tradeDate: Date,
  now = new Date(),
  periodAnchor?: Date
): boolean {
  const a = getTradingPeriodBounds(now, periodAnchor).periodStart.getTime();
  const b = getTradingPeriodBounds(tradeDate, periodAnchor).periodStart.getTime();
  return a === b;
}

export async function getGlobalDailyVolumeSince(
  prisma: Pick<PrismaClient, "rewardSetting">
): Promise<Date | null> {
  const row = await prisma.rewardSetting.findUnique({ where: { key: GLOBAL_DAILY_VOLUME_SINCE_KEY } });
  if (!row?.value?.trim()) return null;
  const d = new Date(row.value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function setGlobalDailyVolumeSince(
  prisma: Pick<PrismaClient, "rewardSetting">,
  at = new Date()
): Promise<Date> {
  const iso = at.toISOString();
  await prisma.rewardSetting.upsert({
    where: { key: GLOBAL_DAILY_VOLUME_SINCE_KEY },
    update: { value: iso },
    create: { key: GLOBAL_DAILY_VOLUME_SINCE_KEY, value: iso }
  });
  return at;
}
