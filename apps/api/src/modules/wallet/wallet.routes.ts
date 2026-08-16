import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../shared/db/prisma.js";
import { requireAuth, requireFullAccess, AuthRequest } from "../auth/auth.middleware.js";
import { TestnetChainAdapter } from "./wallet.testnet-adapter.js";

const adapter = new TestnetChainAdapter();
export const walletRouter = Router();

walletRouter.post("/burn", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  const amount = z.number().positive().parse(req.body.amount);
  const txHash = await adapter.sendBurn(amount);
  await prisma.burnLog.create({ data: { userId: req.user!.sub, amount, reason: "manual_burn", chainTxHash: txHash } });
  res.json({ txHash });
});

walletRouter.post("/liquidity", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  const amount = z.number().positive().parse(req.body.amount);
  const txHash = await adapter.addLiquidity(amount);
  await prisma.liquidityLog.create({
    data: { userId: req.user!.sub, amount, source: "manual_liquidity", chainTxHash: txHash }
  });
  res.json({ txHash });
});
