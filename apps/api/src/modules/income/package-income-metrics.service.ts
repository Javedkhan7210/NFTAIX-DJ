import { Prisma, type PrismaClient } from "@prisma/client";
import { sumUserNftHoldListPriceUsdt } from "../nft/nft-user-hold-value.service.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** `@db.Decimal(18, 2)` — max magnitude Postgres accepts without overflow. */
const MAX_BUY_VOLUME_USDT = new Prisma.Decimal("9999999999999999.99");
/** `@db.Decimal(18, 6)` — detail: absolute value must be &lt; 10^12. */
const MAX_DECIMAL_18_6 = new Prisma.Decimal("999999999999.999999");

function clampNonNegative(d: Prisma.Decimal, max: Prisma.Decimal): Prisma.Decimal {
  if (d.lt(0)) return new Prisma.Decimal(0);
  if (d.gt(max)) return max;
  return d;
}

export type PackageIncomeMetricsSnapshot = {
  buyVolumeUsdt: number;
  holdNftAmountUsdt: number;
  totalSpentUsdt: number;
  incomeFromPackageUsdt: number;
  tradingIncomeFromPackageUsdt: number;
};

/**
 * Buy volume (sum of `TradingLog.volume`) minus held NFT list value (same rules as `GET /api/nft` — DB + chain),
 * then income = max(0, total spent) × 10%, trading quote = income × 30%. Upserts `UserPackageIncomeMetrics`.
 */
export async function syncUserPackageIncomeMetrics(prisma: Db, userId: string): Promise<PackageIncomeMetricsSnapshot> {
  const volSum = await prisma.tradingLog.aggregate({
    where: { userId },
    _sum: { volume: true }
  });

  const buyRaw = new Prisma.Decimal(volSum._sum.volume ?? 0);
  const holdRaw = await sumUserNftHoldListPriceUsdt(prisma, userId);
  const buy = clampNonNegative(buyRaw, MAX_BUY_VOLUME_USDT);
  const hold = clampNonNegative(holdRaw, MAX_DECIMAL_18_6);
  let totalSpent = buy.minus(hold);
  if (totalSpent.lt(0)) {
    totalSpent = new Prisma.Decimal(0);
  }
  totalSpent = clampNonNegative(totalSpent, MAX_DECIMAL_18_6);
  const income = clampNonNegative(totalSpent.mul(0.1), MAX_DECIMAL_18_6);
  const tradingDerived = clampNonNegative(income.mul(0.3), MAX_DECIMAL_18_6);

  await prisma.userPackageIncomeMetrics.upsert({
    where: { userId },
    create: {
      userId,
      buyVolumeUsdt: buy,
      holdNftAmountUsdt: hold,
      totalSpentUsdt: totalSpent,
      incomeUsdt: income,
      tradingIncomeDerivedUsdt: tradingDerived
    },
    update: {
      buyVolumeUsdt: buy,
      holdNftAmountUsdt: hold,
      totalSpentUsdt: totalSpent,
      incomeUsdt: income,
      tradingIncomeDerivedUsdt: tradingDerived
    }
  });

  return {
    buyVolumeUsdt: Number(buy),
    holdNftAmountUsdt: Number(hold),
    totalSpentUsdt: Number(totalSpent),
    incomeFromPackageUsdt: Number(income),
    tradingIncomeFromPackageUsdt: Number(tradingDerived)
  };
}
