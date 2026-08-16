import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../shared/db/prisma.js";
import { mergeDashboardPayload } from "./site-content.defaults.js";
import { claimTestnetFaucet, isTestnetFaucetEnabled } from "./testnet-faucet.service.js";
import { isAdminGasSponsorEnabled, sponsorUserGas } from "./admin-gas-sponsor.service.js";

export const publicRouter = Router();

/** Public CMS for user dashboard (home) — no auth. */
publicRouter.get("/dashboard-content", async (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const row = await prisma.siteContent.findUnique({ where: { id: "default" } });
  const payload = mergeDashboardPayload(row?.payload ?? {});
  res.json({
    payload,
    updatedAt: row?.updatedAt?.toISOString() ?? new Date(0).toISOString()
  });
});

/** Public metrics for UI badges (safe aggregates only) — no auth. */
publicRouter.get("/stats", async (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const totalUsers = await prisma.user.count();
  res.json({ totalUsers });
});

/** Whether the signup faucet (tBNB + MockUSDT) is available. */
publicRouter.get("/testnet-faucet", (_req, res) => {
  res.json({ enabled: isTestnetFaucetEnabled() });
});

/**
 * Testnet-only faucet: send a little native gas + mint MockUSDT to `address`.
 * No wallet popup — funded by CONTRACT_ADMIN_PRIVATE_KEY.
 */
publicRouter.post("/testnet-faucet", async (req, res) => {
  const body = z.object({ address: z.string().min(42).max(42) }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Body must include wallet address (0x…)." });
  }
  try {
    const result = await claimTestnetFaucet(body.data.address);
    return res.json(result);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return res.status(e.status ?? 500).json({ message: e.message ?? "Faucet failed" });
  }
});

/** TEMPORARY testnet — admin pays tBNB gas only (no USDT mint). */
publicRouter.get("/admin-gas-sponsor", (_req, res) => {
  res.json({ enabled: isAdminGasSponsorEnabled() });
});

publicRouter.post("/admin-gas-sponsor", async (req, res) => {
  const body = z.object({ address: z.string().min(42).max(42) }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Body must include wallet address (0x…)." });
  }
  try {
    const result = await sponsorUserGas(body.data.address);
    return res.json(result);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return res.status(e.status ?? 500).json({ message: e.message ?? "Gas sponsor failed" });
  }
});
