import { PrismaClient, TradingComplianceStatus } from "@prisma/client";
import { syncUserPackageIncomeMetrics } from "../income/package-income-metrics.service.js";
import { getPreviousTradingPeriodBounds, getTradingPeriodBounds } from "./trading-period.js";

/** Global pool payouts require an explicit compliant record for the prior trading period. */
export function isPreviousPeriodComplianceRecordEligible(
  row: { status: string; requiredVolume: { toString(): string } | number } | null
): boolean {
  if (!row) return false;
  if (row.status === "compliant") return true;
  const required = Number(row.requiredVolume);
  if (!Number.isFinite(required) || required <= 0) return true;
  return false;
}

export class TradingComplianceService {
  constructor(private readonly prisma: PrismaClient) {}

  private async minCompliancePct(): Promise<number> {
    const row = await this.prisma.rewardSetting.findUnique({ where: { key: "trading.dailyComplianceMinPct" } });
    if (!row) return 50;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : 50;
  }

  async evaluateDay(
    userId: string,
    day: Date,
    requiredVolume: number,
    achievedVolume: number,
    periodAnchor?: Date
  ) {
    const dayKey = getTradingPeriodBounds(day, periodAnchor).periodKey;
    const minPct = await this.minCompliancePct();
    /** No daily requirement → treat as compliant (otherwise pct=0 forced everyone non-compliant and burned subscription income). */
    const pct = requiredVolume <= 0 ? 100 : (achievedVolume / requiredVolume) * 100;
    const status: TradingComplianceStatus = pct >= minPct ? "compliant" : "non_compliant";
    const prev = await this.prisma.dailyTradingCompliance.findFirst({
      where: { userId },
      orderBy: { day: "desc" }
    });
    const consecutiveMiss = status === "non_compliant" ? (prev?.consecutiveMiss ?? 0) + 1 : 0;

    const record = await this.prisma.dailyTradingCompliance.upsert({
      where: { userId_day: { userId, day: dayKey } },
      update: { requiredVolume, achievedVolume, status, consecutiveMiss },
      create: { userId, day: dayKey, requiredVolume, achievedVolume, status, consecutiveMiss }
    });

    if (status === "non_compliant") {
      await this.prisma.burnLog.create({
        data: { userId, amount: requiredVolume - achievedVolume, reason: "daily_trading_non_compliance" }
      });
      await this.prisma.nFTRecord.updateMany({
        where: { userId, isBurned: false },
        data: { isBurned: true, burnedAt: new Date() }
      });
      try {
        await syncUserPackageIncomeMetrics(this.prisma, userId);
      } catch {
        /* best-effort */
      }
    }

    return record;
  }

  /** True when the user met daily trading requirements in the period before `at`. */
  async wasCompliantInPreviousPeriod(userId: string, at = new Date(), periodAnchor?: Date): Promise<boolean> {
    const { periodKey } = getPreviousTradingPeriodBounds(at, periodAnchor);
    const row = await this.prisma.dailyTradingCompliance.findUnique({
      where: { userId_day: { userId, day: periodKey } }
    });
    return isPreviousPeriodComplianceRecordEligible(row);
  }
}
