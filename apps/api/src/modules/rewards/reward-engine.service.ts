import { IncomeType, Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../shared/config/env.js";
import { splitAmountByDailyCap } from "../income/income-daily-cap.js";
import { ReferralService } from "../referral/referral.service.js";

export class RewardEngineService {
  constructor(private readonly prisma: PrismaClient) {}

  private async grantIncomeCapped(
    tx: Prisma.TransactionClient,
    recipientId: string,
    amount: number,
    base: {
      sourceUserId?: string;
      incomeType: IncomeType;
      lockedUntil: Date;
      /** When set (e.g. activation block time), daily cap uses this UTC day instead of "now". */
      incomeCapAsOf?: Date;
    }
  ): Promise<void> {
    if (amount <= 0) return;
    const capDay = base.incomeCapAsOf ?? new Date();
    const { grant, excess } = await splitAmountByDailyCap(tx, recipientId, amount, capDay);
    if (grant > 0) {
      await tx.incomeLedger.create({
        data: {
          userId: recipientId,
          sourceUserId: base.sourceUserId,
          incomeType: base.incomeType,
          amount: grant,
          lockedUntil: base.lockedUntil
        }
      });
    }
    if (excess > 0) {
      await tx.burnLog.create({
        data: {
          userId: recipientId,
          amount: excess,
          reason: "daily_income_cap_overflow"
        }
      });
    }
  }

  private async getNumberSetting(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.rewardSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : fallback;
  }

  private async lockHours(): Promise<number> {
    return this.getNumberSetting("income.visibilityLockHours", 24);
  }

  private startOfUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /** True if user has no compliance row for the day or status is compliant. */
  async isUserTradingCompliantForDay(userId: string, day: Date): Promise<boolean> {
    const dayStart = this.startOfUtcDay(day);
    const row = await this.prisma.dailyTradingCompliance.findUnique({
      where: { userId_day: { userId, day: dayStart } }
    });
    if (!row) return true;
    if (row.status === "compliant") return true;
    const required = Number(row.requiredVolume);
    /** Legacy bug: required 0 was stored as non_compliant; activations on that day should not burn income. */
    if (!Number.isFinite(required) || required <= 0) return true;
    return false;
  }

  async processActivationDistribution(
    userId: string,
    activationId: string,
    activationAmount: number,
    sponsorId?: string,
    opts?: { complianceAsOf?: Date; incomeCapAsOf?: Date }
  ) {
    const already = await this.prisma.tokenDistributionLog.findFirst({
      where: { activationId },
      select: { id: true }
    });
    if (already) {
      return {
        directAmount: 0,
        networkAmount: 0,
        creatorAmount: 0,
        burnAmount: 0,
        liquidityAmount: 0,
        globalAmount: 0,
        perLevelNetworkShare: 0,
        networkLevels: 20
      };
    }

    const directPct = await this.getNumberSetting("activation.directSponsorPct", 20);
    const networkPct = await this.getNumberSetting("activation.networkPct", 40);
    const creatorPct = await this.getNumberSetting("activation.creatorPct", 10);
    const burnPct = await this.getNumberSetting("activation.burnPct", 20);
    const liquidityPct = await this.getNumberSetting("activation.liquidityPct", 5);
    const globalPct = await this.getNumberSetting("activation.globalPct", 5);

    const directAmount = (activationAmount * directPct) / 100;
    const networkAmount = (activationAmount * networkPct) / 100;
    const creatorAmount = (activationAmount * creatorPct) / 100;
    const burnAmount = (activationAmount * burnPct) / 100;
    const liquidityAmount = (activationAmount * liquidityPct) / 100;
    const globalAmount = (activationAmount * globalPct) / 100;

    /** Network slice split across 20 level slots (client: 2% of activation each when networkPct = 40). */
    const perLevelNetworkShare = networkAmount / 20;

    const hours = await this.lockHours();
    const lockedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const complianceDay = opts?.complianceAsOf ?? new Date();
    const capAsOf = opts?.incomeCapAsOf ?? new Date();

    const activatingUserCompliant = await this.isUserTradingCompliantForDay(userId, complianceDay);

    const result = await this.prisma.$transaction(async (tx) => {
      const referrals = new ReferralService(tx as unknown as PrismaClient);

      /** Direct + network: paid regardless of activator daily trading compliance (temporary product rule). */
      if (sponsorId) {
        await this.grantIncomeCapped(tx, sponsorId, directAmount, {
          sourceUserId: userId,
          incomeType: IncomeType.direct,
          lockedUntil,
          incomeCapAsOf: capAsOf
        });
      }

      const chain = await referrals.getUplineUserIds(userId);
      let payoutChain = chain;
      if (!payoutChain.length && sponsorId) {
        payoutChain = [sponsorId, ...(await referrals.getUplineUserIds(sponsorId))];
      }

      if (perLevelNetworkShare > 0) {
        for (let depth = 1; depth <= 20; depth++) {
          if (depth > payoutChain.length) {
            await tx.burnLog.create({
              data: { userId, amount: perLevelNetworkShare, reason: `network_level_${depth}_no_upline` }
            });
            continue;
          }
          const ancestorId = payoutChain[depth - 1];
          const maxDepth = await referrals.maxPayoutLevelsForUserId(ancestorId);
          if (maxDepth < depth) {
            await tx.burnLog.create({
              data: {
                userId,
                amount: perLevelNetworkShare,
                reason: `network_level_${depth}_upline_unlock_insufficient`
              }
            });
            continue;
          }
          const incomeType = depth === 1 ? IncomeType.team : IncomeType.network;
          await this.grantIncomeCapped(tx, ancestorId, perLevelNetworkShare, {
            sourceUserId: userId,
            incomeType,
            lockedUntil,
            incomeCapAsOf: capAsOf
          });
        }
      }

      if (activatingUserCompliant) {
        const creatorId = env.PROJECT_CREATOR_USER_ID?.trim();
        if (creatorAmount > 0) {
          if (creatorId) {
            await this.grantIncomeCapped(tx, creatorId, creatorAmount, {
              sourceUserId: userId,
              incomeType: IncomeType.other,
              lockedUntil,
              incomeCapAsOf: capAsOf
            });
          } else {
            await tx.burnLog.create({
              data: { userId, amount: creatorAmount, reason: "activation_creator_unconfigured" }
            });
          }
        }

        /* Global slice (activation.globalPct) is booked on-chain in GlobalPool on-chain credit — not DB-accrued. */
      } else {
        if (creatorAmount > 0) {
          await tx.burnLog.create({
            data: { userId, amount: creatorAmount, reason: "creator_income_burned_activator_non_compliant" }
          });
        }
      }

      await tx.tokenDistributionLog.create({
        data: {
          userId,
          activationId,
          directSponsorPct: directPct,
          networkPct,
          creatorPct,
          burnPct,
          liquidityPct,
          globalPct
        }
      });

      await tx.burnLog.create({ data: { userId, amount: burnAmount, reason: "activation_allocation" } });
      await tx.liquidityLog.create({ data: { userId, amount: liquidityAmount, source: "activation_allocation" } });

      return {
        directAmount,
        networkAmount,
        creatorAmount,
        burnAmount,
        liquidityAmount,
        globalAmount,
        perLevelNetworkShare,
        networkLevels: 20
      };
    });

    return result;
  }

  /**
   * Grant marketplace NFT resale “trading income” inside an existing Prisma transaction (paired with
   * `NftSaleTradingIncome` idempotency row in the chain indexer).
   */
  async grantNftTradingIncomeInTx(
    tx: Prisma.TransactionClient,
    params: {
      recipientUserId: string;
      sourceUserId?: string;
      sellerExtraUsdt: number;
      incomeCapAsOf?: Date;
    }
  ): Promise<void> {
    if (!Number.isFinite(params.sellerExtraUsdt) || params.sellerExtraUsdt <= 0) return;
    const hours = await this.lockHours();
    const lockedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const capAsOf = params.incomeCapAsOf ?? new Date();
    await this.grantIncomeCapped(tx, params.recipientUserId, params.sellerExtraUsdt, {
      sourceUserId: params.sourceUserId,
      incomeType: IncomeType.nft,
      lockedUntil,
      incomeCapAsOf: capAsOf
    });
  }

  /**
   * Mirrors marketplace NFT resale seller bonus into `IncomeLedger` as `nft` (same economics as
   * `GET /api/income/nft-extra-earned`) so the Income page and `/income/history` stay aligned with on-chain sales.
   */
  async mirrorNftResaleSellerIncome(params: {
    recipientUserId: string;
    sourceUserId?: string;
    sellerExtraUsdt: number;
    incomeCapAsOf?: Date;
  }): Promise<void> {
    if (!Number.isFinite(params.sellerExtraUsdt) || params.sellerExtraUsdt <= 0) return;
    await this.prisma.$transaction(async (tx) => {
      await this.grantNftTradingIncomeInTx(tx, params);
    });
  }

  async unlockEligibleIncomes(now = new Date()) {
    const due = await this.prisma.incomeLedger.findMany({
      where: { status: "locked", lockedUntil: { lte: now } }
    });

    for (const row of due) {
      await this.prisma.$transaction([
        this.prisma.incomeLedger.update({
          where: { id: row.id },
          data: { status: "unlocked" }
        }),
        this.prisma.incomeLog.create({
          data: {
            incomeId: row.id,
            fromStatus: "locked",
            toStatus: "unlocked",
            reason: "lock_expired"
          }
        })
      ]);
    }

    return { unlockedCount: due.length };
  }
}
