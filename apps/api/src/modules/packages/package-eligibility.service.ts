import { PrismaClient } from "@prisma/client";

const upgradeRules: Record<number, { requiredAmount: number; requiredDays: number }> = {
  500: { requiredAmount: 250, requiredDays: 90 },
  1000: { requiredAmount: 500, requiredDays: 30 },
  2500: { requiredAmount: 1000, requiredDays: 30 },
  5000: { requiredAmount: 2500, requiredDays: 30 }
};

export type NftQualifyDeadlineDto = {
  nextTierActivationAmount: number;
  requiredDays: number;
  deadline: string;
  durationMet: boolean;
};

/** $500 path: need 90 separate daily compliance rows (since $250 activation), each ≥ minPct of required volume. */
const UPGRADE_500_COMPLIANCE_DAYS = 90;

export class PackageEligibilityService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Time window to satisfy **duration** rule before upgrading to the next package tier
   * (matches `upgradeRules` used in `checkUpgradeEligibility`).
   */
  computeNftQualifyDeadline(
    current: { activatedAt: Date; tier: { activationAmount: unknown } } | null,
    nextTier: { activationAmount: unknown } | null
  ): NftQualifyDeadlineDto | null {
    if (!current || !nextTier) return null;
    const nextAmt = Number(nextTier.activationAmount);
    const rule = upgradeRules[nextAmt];
    if (!rule) return null;
    if (Number(current.tier.activationAmount) !== rule.requiredAmount) return null;
    const deadline = new Date(current.activatedAt.getTime() + rule.requiredDays * 86400 * 1000);
    const durationMet = Date.now() >= deadline.getTime();
    return {
      nextTierActivationAmount: nextAmt,
      requiredDays: rule.requiredDays,
      deadline: deadline.toISOString(),
      durationMet
    };
  }

  private async minComplianceFraction(): Promise<number> {
    const row = await this.prisma.rewardSetting.findUnique({ where: { key: "trading.dailyComplianceMinPct" } });
    if (!row) return 0.5;
    const n = Number(row.value);
    return Number.isFinite(n) ? n / 100 : 0.5;
  }

  async checkUpgradeEligibility(userId: string, toAmount: number) {
    const rule = upgradeRules[toAmount];
    if (!rule) return { eligible: true, reason: "No rule required" };
    const active = await this.prisma.packageActivation.findFirst({
      where: { userId, isCurrent: true, tier: { activationAmount: rule.requiredAmount } },
      include: { tier: true }
    });
    if (!active) return { eligible: false, reason: `Requires active $${rule.requiredAmount}` };
    const activeDays = Math.floor((Date.now() - new Date(active.activatedAt).getTime()) / (1000 * 60 * 60 * 24));
    const meetsDuration = activeDays >= rule.requiredDays;

    const minFrac = await this.minComplianceFraction();

    if (toAmount === 500) {
      /** Cover ~three months: 90 daily compliance rows since $250 package day (UTC), each ≥ min % of required volume. */
      const act = new Date(active.activatedAt);
      const sinceUtc = new Date(Date.UTC(act.getUTCFullYear(), act.getUTCMonth(), act.getUTCDate()));
      const rows = await this.prisma.dailyTradingCompliance.findMany({
        where: {
          userId,
          day: { gte: sinceUtc }
        },
        orderBy: { day: "desc" },
        take: UPGRADE_500_COMPLIANCE_DAYS
      });
      const meetsTrading =
        rows.length >= UPGRADE_500_COMPLIANCE_DAYS &&
        rows.every((i) => Number(i.achievedVolume) >= Number(i.requiredVolume) * minFrac);
      return {
        eligible: meetsDuration && meetsTrading,
        reason: meetsTrading
          ? "90-day 50% trading history on $250 satisfied"
          : `Need ${UPGRADE_500_COMPLIANCE_DAYS} logged days at ≥${Math.round(minFrac * 100)}% of daily required volume since $${rule.requiredAmount} activation`
      };
    }

    const last30 = await this.prisma.dailyTradingCompliance.findMany({
      where: { userId },
      take: 30,
      orderBy: { day: "desc" }
    });
    const meetsTrading =
      last30.length >= 30 && last30.every((i) => Number(i.achievedVolume) >= Number(i.requiredVolume) * minFrac);
    return {
      eligible: meetsDuration && meetsTrading,
      reason: "Duration + rolling 30-day 50% trading rule checked"
    };
  }
}
