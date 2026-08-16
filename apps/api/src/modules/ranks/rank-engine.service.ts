import { GlobalRank, IncomeType, Prisma, PrismaClient, Role } from "@prisma/client";
import { env } from "../../shared/config/env.js";
import { splitAmountByDailyCap } from "../income/income-daily-cap.js";
import { TradingComplianceService } from "../trading/trading-compliance.service.js";
import {
  executeGlobalPoolOnChainBurnPayouts,
  executeGlobalPoolOnChainPayouts,
  globalPoolPayoutEnabled,
  resolveGlobalPoolTotalUsdt
} from "./global-pool-chain.service.js";

const RANK_ORDER: GlobalRank[] = [
  "prime_member",
  "elite_builder",
  "royal_leader",
  "global_director",
  "crown_ambassador"
];

export class RankEngineService {
  private readonly tradingCompliance: TradingComplianceService;

  constructor(private readonly prisma: PrismaClient) {
    this.tradingCompliance = new TradingComplianceService(prisma);
  }

  /**
   * Highest matching rank for snapshot rules (no history row written).
   * Prime Member requires at least one wallet connection.
   */
  async resolveRankForUserId(userId: string): Promise<GlobalRank | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { directReferralCount: true, teamCount: true, isActive: true }
    });
    if (!user?.isActive) return null;
    const walletCount = await this.prisma.walletConnection.count({ where: { userId } });
    const rules = await this.prisma.rankRule.findMany({ orderBy: { minTeamSize: "asc" } });
    const matched = rules.filter((r) => {
      if (user.directReferralCount < r.minDirectReferrals || user.teamCount < r.minTeamSize) return false;
      if (r.rank === GlobalRank.prime_member && walletCount === 0) return false;
      return true;
    });
    return matched.at(-1)?.rank ?? null;
  }

  async evaluateUserRank(userId: string) {
    const rank = await this.resolveRankForUserId(userId);
    if (!rank) return null;
    await this.prisma.rankHistory.create({ data: { userId, rank } });
    return rank;
  }

  async distributeGlobalPool(totalPool: number) {
    const result: Record<string, number> = {};
    for (const rank of RANK_ORDER) {
      const rule = await this.prisma.rankRule.findUnique({ where: { rank } });
      if (!rule) continue;
      result[rank] = totalPool * (Number(rule.globalPoolSharePct) / 100);
    }
    return result;
  }

  private async lockHours(): Promise<number> {
    const row = await this.prisma.rewardSetting.findUnique({ where: { key: "income.visibilityLockHours" } });
    if (!row) return 24;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : 24;
  }

  /** Ledger owner for rank buckets with no achievers (`BurnLog` requires a user id). */
  private async resolvePlatformBurnUserId(): Promise<string | null> {
    const creatorId = env.PROJECT_CREATOR_USER_ID?.trim();
    if (creatorId) {
      const exists = await this.prisma.user.findUnique({ where: { id: creatorId }, select: { id: true } });
      if (exists) return creatorId;
    }
    const admin = await this.prisma.user.findFirst({
      where: { role: { in: [Role.admin, Role.superadmin] } },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    });
    return admin?.id ?? null;
  }

  /**
   * Daily global pool: on-chain reserve size only, per-rank ledger + GlobalPool USDT payouts to eligible members.
   * Rank buckets with no achievers are burned (not carried forward).
   */
  async persistGlobalPoolRun(day = new Date()) {
    if (!globalPoolPayoutEnabled()) {
      return { skipped: true as const, reason: "on_chain_payout_not_configured" };
    }

    const { totalPool, funding } = await resolveGlobalPoolTotalUsdt(this.prisma);

    if (totalPool <= 0) {
      return { skipped: true as const, reason: "empty_on_chain_pool" };
    }

    const breakdown = await this.distributeGlobalPool(totalPool);
    const hours = await this.lockHours();
    const lockedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const dayUtc = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));

    const activeUsers = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, createdAt: true }
    });

    const membersByRank: Partial<Record<GlobalRank, string[]>> = {};
    for (const r of RANK_ORDER) membersByRank[r] = [];
    for (const u of activeUsers) {
      const rk = await this.resolveRankForUserId(u.id);
      if (rk && membersByRank[rk]) membersByRank[rk]!.push(u.id);
    }

    const previousPeriodCompliant = new Map<string, boolean>();
    for (const u of activeUsers) {
      previousPeriodCompliant.set(
        u.id,
        await this.tradingCompliance.wasCompliantInPreviousPeriod(u.id, day, u.createdAt)
      );
    }

    const platformBurnUserId = await this.resolvePlatformBurnUserId();
    if (!platformBurnUserId) {
      throw new Error(
        "global pool: no platform burn user — set PROJECT_CREATOR_USER_ID or create an admin account"
      );
    }

    const pool = await this.prisma.$transaction(async (tx) => {
      const gp = await tx.globalPool.create({
        data: {
          day: dayUtc,
          totalAmount: totalPool,
          status: "distributing",
          metadata: {
            funding,
            onChainPayoutEnabled: globalPoolPayoutEnabled()
          } as Prisma.InputJsonValue
        }
      });

      let distributed = 0;
      let incomeRows = 0;
      let burnedNonCompliant = 0;
      let burnedEmptyRank = 0;
      let burnedCapOverflow = 0;

      for (const rank of RANK_ORDER) {
        const amount = breakdown[rank] ?? 0;
        await tx.globalPoolDistribution.create({
          data: {
            globalPoolId: gp.id,
            rank,
            amount
          }
        });
        distributed += amount;

        const members = membersByRank[rank] ?? [];
        if (amount > 0 && members.length > 0) {
          const share = amount / members.length;
          for (const uid of members) {
            const compliant = previousPeriodCompliant.get(uid) ?? false;
            if (!compliant) {
              await tx.burnLog.create({
                data: {
                  userId: uid,
                  amount: share,
                  reason: "global_pool_previous_period_non_compliant",
                  globalPoolId: gp.id
                }
              });
              burnedNonCompliant += share;
              continue;
            }

            const { grant, excess } = await splitAmountByDailyCap(tx, uid, share);
            if (grant > 0) {
              await tx.incomeLedger.create({
                data: {
                  userId: uid,
                  incomeType: IncomeType.global_pool,
                  amount: grant,
                  lockedUntil,
                  globalPoolId: gp.id
                }
              });
              incomeRows += 1;
            }
            if (excess > 0) {
              await tx.burnLog.create({
                data: {
                  userId: uid,
                  amount: excess,
                  reason: "daily_income_cap_overflow_global_pool",
                  globalPoolId: gp.id
                }
              });
              burnedCapOverflow += excess;
            }
          }
        } else if (amount > 0 && members.length === 0) {
          await tx.burnLog.create({
            data: {
              userId: platformBurnUserId,
              amount,
              reason: `global_pool_rank_no_achievers:${rank}`,
              globalPoolId: gp.id
            }
          });
          burnedEmptyRank += amount;
        }
      }

      await tx.globalPool.update({
        where: { id: gp.id },
        data: { distributedAmount: distributed, status: "completed" }
      });

      return {
        poolId: gp.id,
        incomeRows,
        burnedNonCompliant,
        burnedEmptyRank,
        burnedCapOverflow
      };
    });

    const onChainPayout = globalPoolPayoutEnabled()
      ? await executeGlobalPoolOnChainPayouts(this.prisma, pool.poolId)
      : null;
    const onChainBurnPayout =
      globalPoolPayoutEnabled() && pool.poolId
        ? await executeGlobalPoolOnChainBurnPayouts(this.prisma, pool.poolId)
        : null;

    if ((onChainPayout || onChainBurnPayout) && pool.poolId) {
      await this.prisma.globalPool.update({
        where: { id: pool.poolId },
        data: {
          metadata: {
            funding,
            onChainPayoutEnabled: true,
            onChainPayout,
            onChainBurnPayout
          } as Prisma.InputJsonValue
        }
      });
    }

    return {
      skipped: false as const,
      poolId: pool.poolId,
      breakdown,
      funding,
      distributed: Object.values(breakdown).reduce((a, b) => a + b, 0),
      rankMemberPayouts: pool.incomeRows,
      burnedNonCompliant: pool.burnedNonCompliant,
      burnedEmptyRank: pool.burnedEmptyRank,
      burnedCapOverflow: pool.burnedCapOverflow,
      onChainPayout,
      onChainBurnPayout
    };
  }
}
