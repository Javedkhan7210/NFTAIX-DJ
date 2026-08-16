import { prisma } from "../../shared/db/prisma.js";
import { runSequentialResaleBot, type SequentialResaleBotResult } from "../trading/resale-bot-keeper.service.js";
import { getTradingPeriodBounds, setGlobalDailyVolumeSince } from "../trading/trading-period.js";

export type ResetAllUsersDailyLimitResult = {
  globalDailyVolumeSince: string;
  tradingPeriodHours: number;
  periodStart: string;
  periodEnd: string;
  deletedComplianceRows: number;
  botRun: SequentialResaleBotResult;
};

/**
 * Resets daily trading allowance for every user (package limits unchanged), then runs the sequential NFT bot once.
 */
export async function resetAllUsersDailyLimitAndRunBot(opts: {
  triggeredBy?: string;
}): Promise<ResetAllUsersDailyLimitResult> {
  const resetAt = new Date();
  const { periodStart, periodEnd, periodKey } = getTradingPeriodBounds(resetAt);

  const globalDailyVolumeSince = await setGlobalDailyVolumeSince(prisma, resetAt);

  const complianceDelete = await prisma.dailyTradingCompliance.deleteMany({
    where: { day: periodKey }
  });

  const botRun = await runSequentialResaleBot({
    trigger: "admin",
    triggeredBy: opts.triggeredBy
  });

  return {
    globalDailyVolumeSince: globalDailyVolumeSince.toISOString(),
    tradingPeriodHours: (periodEnd.getTime() - periodStart.getTime()) / (60 * 60 * 1000),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    deletedComplianceRows: complianceDelete.count,
    botRun
  };
}
