import { Router } from "express";
import { prisma } from "../../shared/db/prisma.js";
import { requireAuth, AuthRequest } from "../auth/auth.middleware.js";
import { RankEngineService } from "./rank-engine.service.js";

const service = new RankEngineService(prisma);
export const rankRouter = Router();

rankRouter.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const rank = await service.evaluateUserRank(req.user!.sub);
  res.json({ rank });
});

rankRouter.get("/history", requireAuth, async (req: AuthRequest, res) => {
  const history = await prisma.rankHistory.findMany({ where: { userId: req.user!.sub }, orderBy: { achievedAt: "desc" } });
  res.json(history);
});
