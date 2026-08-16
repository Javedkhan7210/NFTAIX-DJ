import { Router } from "express";
import { z } from "zod";
import { parseAbi } from "viem";
import { env } from "../../shared/config/env.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { prisma } from "../../shared/db/prisma.js";
import { requireAuth, requireFullAccess, AuthRequest } from "../auth/auth.middleware.js";
import { PackageEligibilityService } from "./package-eligibility.service.js";
import { RewardEngineService } from "../rewards/reward-engine.service.js";
import { syncPackageActivationFromRegistration } from "./registration-sync.service.js";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const activateSchema = z.object({ tierId: z.string() });
const eligibilityService = new PackageEligibilityService(prisma);
const rewardService = new RewardEngineService(prisma);
export const packageRouter = Router();

packageRouter.get("/tiers", async (_req, res) => {
  const tiers = await prisma.packageTier.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  res.json(tiers);
});

packageRouter.get("/subscription-view", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.sub;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { custodialUsdtBalance: true }
  });
  const tiers = await prisma.packageTier.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const sorted = [...tiers].sort((a, b) => Number(a.activationAmount) - Number(b.activationAmount));
  const current = await prisma.packageActivation.findFirst({
    where: { userId, isCurrent: true },
    include: { tier: true }
  });
  const curAmt = current ? Number(current.tier.activationAmount) : 0;
  let nextTier = null;
  if (current && sorted.length) {
    const idx = sorted.findIndex((t) => Number(t.activationAmount) === curAmt);
    if (idx >= 0 && idx < sorted.length - 1) nextTier = sorted[idx + 1];
  } else if (!current && sorted.length) {
    nextTier = sorted[0];
  }
  const nftQualify = eligibilityService.computeNftQualifyDeadline(current, nextTier);
  res.json({
    custodialUsdtBalance: user.custodialUsdtBalance.toString(),
    custodialActivationsEnabled: env.CUSTODIAL_USDT_ENABLED,
    current: current?.tier ?? null,
    next: nextTier,
    nftQualify,
    currentActivation: current
      ? {
          id: current.id,
          activatedAt: current.activatedAt.toISOString(),
          expiresAt: current.expiresAt?.toISOString() ?? null,
          onChain: current.onChain,
          tierId: current.tierId
        }
      : null
  });
});

packageRouter.post("/activate", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  if (!env.CUSTODIAL_USDT_ENABLED) {
    return res.status(410).json({
      message:
        "Custodial package activation is disabled. Subscribe with USDT on-chain (Upgrade page → wallet activation)."
    });
  }
  const { tierId } = activateSchema.parse(req.body);
  const tier = await prisma.packageTier.findUniqueOrThrow({ where: { id: tierId } });
  const userId = req.user!.sub;
  const toAmount = Number(tier.activationAmount);
  const { eligible, reason } = await eligibilityService.checkUpgradeEligibility(userId, toAmount);
  if (!eligible) {
    return res.status(422).json({
      message: reason || "Not eligible to activate this package tier yet."
    });
  }

  const walletUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { custodialUsdtBalance: true, sponsorId: true }
  });
  const currentAct = await prisma.packageActivation.findFirst({
    where: { userId, isCurrent: true },
    include: { tier: true }
  });
  const oldAmt = currentAct ? Number(currentAct.tier.activationAmount) : 0;
  const charge = Math.max(0, toAmount - oldAmt);
  const balance = Number(walletUser.custodialUsdtBalance);
  if (charge > 0 && balance < charge) {
    return res.status(402).json({
      message: `Insufficient custodial USDT balance. Required: ${charge.toFixed(2)} USDT. Available: ${balance.toFixed(2)} USDT.`
    });
  }

  const activation = await prisma.$transaction(async (tx) => {
    if (charge > 0) {
      await tx.user.update({
        where: { id: userId },
        data: { custodialUsdtBalance: { decrement: charge } }
      });
      await tx.usdtLedger.create({
        data: {
          userId,
          amount: -charge,
          reason: `subscription_activation_$${toAmount}`
        }
      });
    }
    await tx.packageActivation.updateMany({
      where: { userId, isCurrent: true },
      data: { isCurrent: false }
    });
    return tx.packageActivation.create({
      data: { userId, tierId, isCurrent: true }
    });
  });

  await rewardService.processActivationDistribution(
    userId,
    activation.id,
    toAmount,
    walletUser.sponsorId ?? undefined
  );
  res.status(201).json(activation);
});

/** Backfill `PackageActivation` from Registration `users()` when indexer lagged (no income mint — on-chain already paid). */
packageRouter.post("/sync-on-chain-activation", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  const out = await syncPackageActivationFromRegistration(prisma, req.user!.sub);
  res.json(out);
});

packageRouter.get("/upgrade-eligibility/:toAmount", requireAuth, async (req: AuthRequest, res) => {
  const toAmount = Number(req.params.toAmount);
  const result = await eligibilityService.checkUpgradeEligibility(req.user!.sub, toAmount);
  res.json(result);
});

/** Sponsor wallet + default Registration referrer for register(sponsor) / activate(packageId). */
packageRouter.get("/on-chain-context", requireAuth, requireFullAccess, async (req: AuthRequest, res) => {
  const userId = req.user!.sub;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sponsorId: true }
  });
  let sponsorWallet = ZERO_ADDR;
  if (user?.sponsorId) {
    const sw = await prisma.walletConnection.findFirst({
      where: { userId: user.sponsorId, isPrimary: true }
    });
    if (sw) sponsorWallet = sw.walletAddress;
  }

  let defaultReferrerWallet = ZERO_ADDR;
  const regAddr = env.REGISTRATION_CONTRACT_ADDRESS;
  if (regAddr) {
    const client = getPublicClient();
    defaultReferrerWallet = (await client.readContract({
      address: regAddr as `0x${string}`,
      abi: parseAbi(["function rootSponsor() view returns (address)"]),
      functionName: "rootSponsor"
    })) as string;
  }

  res.json({
    sponsorWallet,
    defaultReferrerWallet
  });
});
