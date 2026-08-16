import { env } from "../shared/config/env.js";
import { logger } from "../shared/logger.js";
import {
  runBurnNonCompliantLockedIncomes,
  runChainIndexer,
  runGlobalPoolDistribution,
  runInactivityDeactivation,
  runUnlockEligibleIncomes
} from "./job-runner.js";

let unlockTimer: ReturnType<typeof setInterval> | null = null;
let burnTimer: ReturnType<typeof setInterval> | null = null;
let chainTimer: ReturnType<typeof setInterval> | null = null;

/** Daily global pool at ~00:05 UTC when Redis workers are off (cron-like via interval guard). */
function msUntilNextUtc(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startScheduledJobsFallback(): void {
  if (env.REDIS_URL) {
    return;
  }

  logger.warn("REDIS_URL not set — running income/global pool/burn/inactivity on in-process timers");

  unlockTimer = setInterval(() => {
    void runUnlockEligibleIncomes().then((r) => logger.info(r, "cron-fallback: unlock incomes")).catch((e) => logger.error(e));
  }, 60_000);

  burnTimer = setInterval(() => {
    void runBurnNonCompliantLockedIncomes().catch((e) => logger.error(e));
  }, 120_000);

  chainTimer = setInterval(() => {
    void runChainIndexer().then((r) => logger.info(r, "cron-fallback: chain indexer")).catch((e) => logger.error(e));
  }, 20_000);

  const scheduleGlobalLoop = () => {
    const delay = msUntilNextUtc(0, 5);
    setTimeout(() => {
      void runGlobalPoolDistribution()
        .then((r) => logger.info({ r }, "cron-fallback: global pool"))
        .catch((e) => logger.error(e));
      scheduleGlobalLoop();
    }, delay);
  };
  scheduleGlobalLoop();

  const scheduleInactiveLoop = () => {
    const delay = msUntilNextUtc(0, 20);
    setTimeout(() => {
      void runInactivityDeactivation()
        .then((r) => logger.info({ r }, "cron-fallback: inactivity"))
        .catch((e) => logger.error(e));
      scheduleInactiveLoop();
    }, delay);
  };
  scheduleInactiveLoop();
}

export function stopScheduledJobsFallback(): void {
  if (unlockTimer) clearInterval(unlockTimer);
  if (burnTimer) clearInterval(burnTimer);
  if (chainTimer) clearInterval(chainTimer);
  unlockTimer = burnTimer = chainTimer = null;
}
