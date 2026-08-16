import type { Prisma, PrismaClient } from "@prisma/client";
import { getDailyVolumeDivisor } from "../trading/trading-divisor.js";

const ENABLED_KEY = "income.dailyCapEnabled";
const PCT_KEY = "income.dailyCapPct";

type Db = PrismaClient | Prisma.TransactionClient;

async function getNumberSetting(db: Db, key: string, fallback: number): Promise<number> {
  const row = await db.rewardSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

async function isDailyCapEnabled(db: Db): Promise<boolean> {
  const row = await db.rewardSetting.findUnique({ where: { key: ENABLED_KEY } });
  if (!row) return true;
  const v = row.value.trim().toLowerCase();
  return v !== "false" && v !== "0";
}

/** Max total new income (sum of IncomeLedger.amount) per recipient per UTC day; Infinity when disabled or no tier. */
export async function getDailyIncomeCapUsd(db: Db, userId: string): Promise<number> {
  if (!(await isDailyCapEnabled(db))) return Infinity;

  const pct = await getNumberSetting(db, PCT_KEY, 50);
  if (pct <= 0) return Infinity;

  const activation = await db.packageActivation.findFirst({
    where: { userId, isCurrent: true },
    include: { tier: true }
  });
  if (!activation) return Infinity;

  const divisor = await getDailyVolumeDivisor(db);
  const dailyAllowance = Number(activation.tier.tradingLimit) / divisor;
  if (!Number.isFinite(dailyAllowance) || dailyAllowance <= 0) return Infinity;

  return (dailyAllowance * pct) / 100;
}

export async function sumIncomeCreatedUtcDay(
  db: Db,
  userId: string,
  dayStart: Date,
  dayEnd: Date
): Promise<number> {
  const agg = await db.incomeLedger.aggregate({
    where: { userId, createdAt: { gte: dayStart, lt: dayEnd } },
    _sum: { amount: true }
  });
  return Number(agg._sum.amount ?? 0);
}

function utcDayBounds(d: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return { dayStart, dayEnd };
}

/**
 * Returns { grant, excess } where grant fits under today's cap; excess should be diverted (e.g. burn log).
 */
export async function splitAmountByDailyCap(
  db: Db,
  userId: string,
  amount: number,
  now = new Date()
): Promise<{ grant: number; excess: number }> {
  if (amount <= 0) return { grant: 0, excess: 0 };
  const cap = await getDailyIncomeCapUsd(db, userId);
  if (!Number.isFinite(cap) || cap === Infinity) return { grant: amount, excess: 0 };

  const { dayStart, dayEnd } = utcDayBounds(now);
  const used = await sumIncomeCreatedUtcDay(db, userId, dayStart, dayEnd);
  const room = Math.max(0, cap - used);
  const grant = Math.min(amount, room);
  const excess = amount - grant;
  return { grant, excess };
}
