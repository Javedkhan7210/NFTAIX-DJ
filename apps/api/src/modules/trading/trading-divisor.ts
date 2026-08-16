import type { PrismaClient } from "@prisma/client";

const KEY = "trading.dailyVolumeDivisor";

/**
 * Daily trading cap = tier.tradingLimit / divisor.
 * Default 1 → $5 package = $50/day, $25 package = $250/day (see seed package tiers).
 */
export async function getDailyVolumeDivisor(prisma: Pick<PrismaClient, "rewardSetting">): Promise<number> {
  const row = await prisma.rewardSetting.findUnique({ where: { key: KEY } });
  const n = row ? Number(row.value) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}
