import { Router } from "express";
import { prisma } from "../../shared/db/prisma.js";
import { requireAuth, requireRole, AuthRequest } from "../auth/auth.middleware.js";
import { RewardEngineService } from "./reward-engine.service.js";

const service = new RewardEngineService(prisma);
export const rewardRouter = Router();

/** Public compensation snapshot for app UI (single source of truth with seed / RewardSetting). */
rewardRouter.get("/public-rules", async (_req, res) => {
  const keys = [
    "activation.directSponsorPct",
    "activation.networkPct",
    "activation.creatorPct",
    "activation.burnPct",
    "activation.liquidityPct",
    "activation.globalPct",
    "referral.levelUnlock",
    "nft.sellPercent",
    "nft.income.sellerPct",
    "nft.income.levelPct",
    "nft.income.burnPct",
    "nft.income.liquidityPct",
    "nft.income.platformPct",
    "trading.dailyComplianceMinPct"
  ] as const;
  const rows = await prisma.rewardSetting.findMany({ where: { key: { in: [...keys] } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>;
  const num = (k: string, fb: number) => {
    const v = Number(map[k]);
    return Number.isFinite(v) ? v : fb;
  };
  let levelUnlock: { minDirect: number; maxLevels: number }[] = [
    { minDirect: 1, maxLevels: 2 },
    { minDirect: 10, maxLevels: 20 }
  ];
  try {
    const parsed = JSON.parse(map["referral.levelUnlock"] ?? "[]") as typeof levelUnlock;
    if (Array.isArray(parsed) && parsed.length) levelUnlock = parsed;
  } catch {
    /* keep default */
  }
  const rankRules = await prisma.rankRule.findMany({
    orderBy: { minTeamSize: "asc" }
  });
  res.json({
    activation: {
      directSponsorPct: num("activation.directSponsorPct", 20),
      networkPct: num("activation.networkPct", 40),
      creatorPct: num("activation.creatorPct", 10),
      burnPct: num("activation.burnPct", 20),
      liquidityPct: num("activation.liquidityPct", 5),
      globalPct: num("activation.globalPct", 5),
      networkLevels: 20,
      networkPerLevelOfActivationPct: num("activation.networkPct", 40) / 20
    },
    levelUnlock,
    nft: {
      sellPercent: num("nft.sellPercent", 10),
      /** Share of appreciation to current NFT holder (matches marketplace holder bps). */
      sellerPct: num("nft.income.sellerPct", 30),
      levelPct: num("nft.income.levelPct", 35),
      burnPct: num("nft.income.burnPct", 15),
      liquidityPct: num("nft.income.liquidityPct", 10),
      platformPct: num("nft.income.platformPct", 10),
      valueIncreasePct: num("nft.sellPercent", 10)
    },
    trading: {
      dailyComplianceMinPct: num("trading.dailyComplianceMinPct", 50)
    },
    ranks: rankRules.map((r) => ({
      rank: r.rank,
      minDirectReferrals: r.minDirectReferrals,
      minTeamSize: r.minTeamSize,
      globalPoolSharePct: Number(r.globalPoolSharePct)
    }))
  });
});

rewardRouter.get("/wallet", requireAuth, async (req: AuthRequest, res) => {
  const incomes = await prisma.incomeLedger.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: "desc" }
  });
  const locked = incomes.filter((i) => i.status === "locked");
  const unlocked = incomes.filter((i) => i.status === "unlocked");
  const burned = incomes.filter((i) => i.status === "burned");
  const rowJson = (i: (typeof incomes)[number]) => ({
    id: i.id,
    userId: i.userId,
    sourceUserId: i.sourceUserId,
    incomeType: i.incomeType,
    amount: i.amount.toString(),
    status: i.status,
    lockedUntil: i.lockedUntil,
    createdAt: i.createdAt
  });
  res.json({
    locked: locked.map(rowJson),
    unlocked: unlocked.map(rowJson),
    burned: burned.map(rowJson),
    total: incomes.map(rowJson)
  });
});

rewardRouter.post("/unlock", requireAuth, requireRole(["admin", "superadmin"]), async (_req, res) => {
  const result = await service.unlockEligibleIncomes();
  res.json(result);
});
