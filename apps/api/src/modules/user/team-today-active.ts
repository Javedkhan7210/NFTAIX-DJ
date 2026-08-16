import type { PrismaClient } from "@prisma/client";
import { getDailyTradingMetrics } from "../trading/trading-daily-metrics.js";

/**
 * Team "Active" = met today's required daily trading volume (50% of period allowance).
 * Temporary: resets each trading period. Not permanently inactive / not-activated.
 */
export async function todayTradingActiveByUserIds(
  prisma: PrismaClient,
  userIds: string[],
  now = new Date()
): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  if (userIds.length === 0) return out;

  const activations = await prisma.packageActivation.findMany({
    where: { userId: { in: userIds }, isCurrent: true },
    include: { tier: { select: { tradingLimit: true } } }
  });
  const byUser = new Map(activations.map((a) => [a.userId, a]));

  await Promise.all(
    userIds.map(async (userId) => {
      const activation = byUser.get(userId);
      if (!activation) {
        out.set(userId, null);
        return;
      }
      const metrics = await getDailyTradingMetrics(prisma, userId, activation, now);
      const required = metrics.dailyAllowance * 0.5;
      if (required <= 0) {
        out.set(userId, null);
        return;
      }
      out.set(userId, metrics.periodTradedVolume >= required);
    })
  );

  return out;
}
