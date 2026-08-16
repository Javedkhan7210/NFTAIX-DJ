import { PrismaClient } from "@prisma/client";
import { syncUserPackageIncomeMetrics } from "../income/package-income-metrics.service.js";

/** Matches on-chain `sellPercent` (percent points, e.g. 10 = 10%). */
const DEFAULT_SELL_PERCENT = 10;

export type NftAppreciationSplit = {
  holderOfAppreciation: number;
  levelIncome: number;
  burn: number;
  liquiditySupport: number;
  platform: number;
  /** Kept on marketplace contract until owner calls `withdrawSaleGlobalIncome` on-chain. */
  globalIncome: number;
};

export type ResalePreview = {
  previousPrice: number;
  /** Next listed sale price (base + appreciation). */
  salePrice: number;
  appreciation: number;
  /** Same as previousPrice — paid to prior owner before appreciation split (matches marketplace resale logic). */
  baseToPreviousOwner: number;
  appreciationSplit: NftAppreciationSplit;
};

export class NftDistributionService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getNumberSetting(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.rewardSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Splits only the appreciation slice (on-chain `extraAmount`), not the full sale price.
   * Percentages are of appreciation and must sum to 100 — mirrors marketplace `setSaleIncomePercent` (‰ on-chain; here stored as whole percents).
   */
  async calculateAppreciationSplit(appreciationAmount: number): Promise<NftAppreciationSplit> {
    const holderPct = await this.getNumberSetting("nft.income.sellerPct", 30);
    const levelPct = await this.getNumberSetting("nft.income.levelPct", 20);
    const burnPct = await this.getNumberSetting("nft.income.burnPct", 25);
    const liquidityPct = await this.getNumberSetting("nft.income.liquidityPct", 10);
    const platformPct = await this.getNumberSetting("nft.income.platformPct", 5);
    const globalPct = await this.getNumberSetting("nft.income.globalPct", 10);

    const sum = holderPct + levelPct + burnPct + liquidityPct + platformPct + globalPct;
    if (Math.abs(sum - 100) > 0.001) {
      throw new Error(`nft.income.* percents must sum to 100 (got ${sum})`);
    }

    return {
      holderOfAppreciation: (appreciationAmount * holderPct) / 100,
      levelIncome: (appreciationAmount * levelPct) / 100,
      burn: (appreciationAmount * burnPct) / 100,
      liquiditySupport: (appreciationAmount * liquidityPct) / 100,
      platform: (appreciationAmount * platformPct) / 100,
      globalIncome: (appreciationAmount * globalPct) / 100
    };
  }

  /** Preview one resale cycle: appreciation = previousPrice * sellPercent/100. */
  async previewResale(previousPrice: number): Promise<ResalePreview> {
    const sellPct = await this.getNumberSetting("nft.sellPercent", DEFAULT_SELL_PERCENT);
    const appreciation = (previousPrice * sellPct) / 100;
    const salePrice = previousPrice + appreciation;
    const appreciationSplit = await this.calculateAppreciationSplit(appreciation);
    return {
      previousPrice,
      salePrice,
      appreciation,
      baseToPreviousOwner: previousPrice,
      appreciationSplit
    };
  }

  /**
   * After one growth step from `baseValue`, returns resale preview for that next price level.
   * Used by POST /mint for DB-only NFT rows (display/education — chain state is authoritative).
   */
  async previewAfterGrowthStep(baseValue: number): Promise<ResalePreview> {
    return this.previewResale(baseValue);
  }

  async burnAllUserNfts(userId: string, reason: string) {
    await this.prisma.nFTRecord.updateMany({
      where: { userId, isBurned: false },
      data: { isBurned: true, burnedAt: new Date() }
    });
    await this.prisma.adminLog.create({
      data: { actorId: userId, action: "nft_burn_batch", targetType: "NFTRecord", targetId: userId, metadata: { reason } }
    });
    try {
      await syncUserPackageIncomeMetrics(this.prisma, userId);
    } catch {
      /* best-effort */
    }
  }
}
