import { env } from "../shared/config/env.js";
import { logger } from "../shared/logger.js";
import {
  getTradingPeriodHours,
  getTradingPeriodMs,
  msUntilNextPeriodBoundary
} from "../modules/trading/trading-period.js";
import { runAutoTradeKeeperJob } from "./job-runner.js";

let timeoutRef: ReturnType<typeof setTimeout> | null = null;

/** Milliseconds until the next `:minute` mark UTC (legacy / status API). */
export function msUntilNextUtcHourly(anchorMinute: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), anchorMinute, 0)
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Runs the sequential resale bot every `TRADING_PERIOD_HOURS` (default 15h), aligned to epoch period boundaries.
 * Each run coincides with a fresh daily trading allowance; users who already met the period target are skipped.
 */
export function startAutoTradeKeeperInterval(): void {
  if (timeoutRef) return;
  if (!env.AUTO_TRADE_EXECUTOR_PRIVATE_KEY?.trim()) {
    logger.info("AUTO_TRADE_EXECUTOR_PRIVATE_KEY unset — in-process auto-trade keeper not started");
    return;
  }

  const periodHours = getTradingPeriodHours();
  const intervalMs = getTradingPeriodMs();

  const scheduleNext = () => {
    const delay = msUntilNextPeriodBoundary();
    logger.info(
      { nextRunInMs: delay, periodHours, periodEndsAt: new Date(Date.now() + delay).toISOString() },
      "auto-trade-keeper: next run scheduled (trading period boundary)"
    );
    timeoutRef = setTimeout(() => {
      timeoutRef = null;
      void runAutoTradeKeeperJob()
        .then((r) => logger.info(r, "auto-trade-keeper (trading period)"))
        .catch((e) => logger.error(e))
        .finally(() => {
          scheduleNext();
        });
    }, delay);
  };

  scheduleNext();
  logger.info({ periodHours, intervalMs }, "auto-trade-keeper: trading-period scheduler started");
}

export function stopAutoTradeKeeperInterval(): void {
  if (timeoutRef) clearTimeout(timeoutRef);
  timeoutRef = null;
}
