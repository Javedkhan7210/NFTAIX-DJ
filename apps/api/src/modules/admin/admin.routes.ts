import { Router } from "express";
import { z } from "zod";
import { isAddress } from "viem";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { Prisma, IncomeType, IncomeStatus } from "@prisma/client";
import { prisma } from "../../shared/db/prisma.js";
import { env } from "../../shared/config/env.js";
import { ChainIndexerService } from "../chain/chain-indexer.service.js";
import { ReferralService } from "../referral/referral.service.js";
import { backfillMissingOnChainActivationRewards } from "../rewards/activation-reward-backfill.service.js";
import { RewardEngineService } from "../rewards/reward-engine.service.js";
import { requireAuth, requireRole, AuthRequest } from "../auth/auth.middleware.js";
import { mergeDashboardPayload, payloadToJsonValue } from "../public/site-content.defaults.js";
import { RegistrationAdminService } from "./registration-admin.service.js";
import { ContractRecoveryService } from "./contract-recovery.service.js";
import { AirdropAdminService } from "./airdrop-admin.service.js";
import { AdminNftMintService } from "./admin-nft-mint.service.js";
import { backfillUserFromRegistrationWallet } from "./user-backfill.service.js";
import {
  getBotPurchaseRunDetail,
  listBotPurchaseRuns,
  runManualTradeForUser,
  runSequentialResaleBot
} from "../trading/resale-bot-keeper.service.js";
import { getAdminNetworksOverview } from "./admin-networks-overview.service.js";
import { resetAllUsersDailyLimitAndRunBot } from "./admin-reset-all-daily.service.js";
import { resetUserTradingLimit } from "./admin-reset-trading-limit.service.js";
import { aggregateUserNftHoldAndSellCounts } from "../nft/nft-market-status.service.js";
import {
  adminFreeRegisterAndActivate,
  adminFreeUpgrade
} from "./admin-free-registration.service.js";

const chainIndexer = new ChainIndexerService(prisma);
const rewardEngine = new RewardEngineService(prisma);
const referralService = new ReferralService(prisma);
const registrationAdmin = new RegistrationAdminService();
const contractRecovery = new ContractRecoveryService();
const airdropAdmin = new AirdropAdminService(prisma);
const adminNftMint = new AdminNftMintService();

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole(["admin", "superadmin"]));

const superadminOnly = requireRole(["superadmin"]);

/** Aggregate counts for admin dashboard (avoids client-side tallies + pagination limits). */
adminRouter.get("/stats", async (_req, res) => {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalUsers, blockedUsers, rewardSettings, nftRecords, recentAdminActions, activeAutoTradeBots] =
    await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { blockedReason: { not: null } } }),
    prisma.rewardSetting.count(),
    prisma.nFTRecord.count(),
    prisma.adminLog.count({ where: { createdAt: { gte: since7d } } }),
    prisma.user.count({ where: { autoTradeBotEnabled: true, isActive: true } })
  ]);
  res.json({ totalUsers, blockedUsers, rewardSettings, nftRecords, recentAdminActions, activeAutoTradeBots });
});

/** Row shape for admin “user NFT details” aggregation (typed for `Set` / maps). */
type HeldNftAdminRow = {
  userId: string;
  tokenId: string;
  mintedAt: Date;
  user: {
    id: string;
    publicUserNumber: number;
    walletConnections: Array<{ walletAddress: string; isPrimary: boolean }>;
    packageActivations: Array<{ tier: { activationAmount: Prisma.Decimal } }>;
  };
};

/** Summary + table: held NFTs (DB) with acquisition age; token airdrop score = 2×current package + direct income. */
adminRouter.get("/user-nft-details", async (_req, res) => {
  const now = Date.now();
  const cutoff18h = new Date(now - 18 * 60 * 60 * 1000);
  const cutoff24h = new Date(now - 24 * 60 * 60 * 1000);

  const [totalNftsSold, totalNftsUnsold, holdSellByUser, heldRecordsRaw] = await Promise.all([
    prisma.nftOwnershipHistory.count({ where: { fromUserId: { not: null } } }),
    prisma.nFTRecord.count({ where: { isBurned: false } }),
    aggregateUserNftHoldAndSellCounts(prisma),
    prisma.nFTRecord.findMany({
      where: { isBurned: false },
      select: {
        userId: true,
        tokenId: true,
        mintedAt: true,
        user: {
          select: {
            id: true,
            publicUserNumber: true,
            walletConnections: { select: { walletAddress: true, isPrimary: true } },
            packageActivations: {
              where: { isCurrent: true },
              take: 1,
              include: { tier: { select: { activationAmount: true } } }
            }
          }
        }
      }
    })
  ]);

  const heldRecords = heldRecordsRaw as HeldNftAdminRow[];

  const userIds = [...new Set(heldRecords.map((r) => r.userId))];
  const tokenIds = [...new Set(heldRecords.map((r) => r.tokenId))];

  const directTotals =
    userIds.length > 0
      ? await prisma.incomeLedger.groupBy({
          by: ["userId"],
          where: {
            userId: { in: userIds },
            incomeType: IncomeType.direct,
            status: { not: IncomeStatus.burned }
          },
          _sum: { amount: true }
        })
      : [];
  const directByUser = new Map(
    directTotals.map((d) => [d.userId, Number(d._sum?.amount ?? 0)])
  );

  const acqRows =
    tokenIds.length > 0 && userIds.length > 0
      ? await prisma.nftOwnershipHistory.findMany({
          where: { tokenId: { in: tokenIds }, toUserId: { in: userIds } },
          select: { tokenId: true, toUserId: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        })
      : [];

  const latestAcq = new Map<string, Date>();
  for (const row of acqRows) {
    const k = `${row.toUserId}:${row.tokenId}`;
    if (!latestAcq.has(k)) latestAcq.set(k, row.createdAt);
  }

  let nftsNotSoldLast24Hours = 0;
  const staleHoldingsOver18Hours: Array<{
    purchaseTime: string;
    userId: string;
    publicUserNumber: number;
    userAddress: string;
    nftId: string;
    tokenAirdrop: number;
  }> = [];

  for (const rec of heldRecords) {
    const k = `${rec.userId}:${rec.tokenId}`;
    const acquiredAt = latestAcq.get(k) ?? rec.mintedAt;
    if (acquiredAt.getTime() > cutoff24h.getTime()) {
      continue;
    }
    nftsNotSoldLast24Hours += 1;

    const wallets = rec.user.walletConnections;
    const userAddress =
      wallets.find((w: { isPrimary: boolean; walletAddress: string }) => w.isPrimary)?.walletAddress ??
      wallets[0]?.walletAddress ??
      "";

    const pkg = Number(rec.user.packageActivations[0]?.tier.activationAmount ?? 0);
    const direct = directByUser.get(rec.userId) ?? 0;
    const tokenAirdrop = 2 * pkg + direct;

    if (acquiredAt.getTime() <= cutoff18h.getTime()) {
      staleHoldingsOver18Hours.push({
        purchaseTime: acquiredAt.toISOString(),
        userId: rec.user.id,
        publicUserNumber: rec.user.publicUserNumber,
        userAddress,
        nftId: rec.tokenId,
        tokenAirdrop
      });
    }
  }

  staleHoldingsOver18Hours.sort(
    (a, b) => new Date(b.purchaseTime).getTime() - new Date(a.purchaseTime).getTime()
  );

  let totalHold = 0;
  let totalInSell = 0;
  for (const row of holdSellByUser.values()) {
    totalHold += row.totalHold;
    totalInSell += row.totalInSell;
  }

  const activeUserIds = [...holdSellByUser.entries()]
    .filter(([, c]) => c.totalHold > 0 || c.totalInSell > 0)
    .map(([id]) => id);

  const usersForHoldSell =
    activeUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: activeUserIds } },
          select: {
            id: true,
            publicUserNumber: true,
            referralCode: true,
            walletConnections: { select: { walletAddress: true, isPrimary: true } }
          },
          orderBy: { publicUserNumber: "asc" }
        })
      : [];

  const perUser = usersForHoldSell.map((u) => {
    const c = holdSellByUser.get(u.id) ?? { totalHold: 0, totalInSell: 0 };
    const wallets = u.walletConnections;
    const userAddress =
      wallets.find((w) => w.isPrimary)?.walletAddress ?? wallets[0]?.walletAddress ?? "";
    return {
      userId: u.id,
      publicUserNumber: u.publicUserNumber,
      referralCode: u.referralCode,
      userAddress,
      totalHold: c.totalHold,
      totalInSell: c.totalInSell
    };
  });

  res.json({
    summary: {
      totalNftsSold,
      totalNftsUnsold,
      nftsNotSoldLast24Hours,
      totalHold,
      totalInSell
    },
    perUser,
    staleHoldingsOver18Hours
  });
});

/** @deprecated wide user list — prefer /users/search */
adminRouter.get("/users", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const take = Math.min(Number(req.query.take ?? 100) || 100, 500);
  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { referralCode: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            {
              walletConnections: {
                some: { walletAddress: { contains: q, mode: "insensitive" } }
              }
            }
          ]
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      walletConnections: { select: { id: true, walletAddress: true, isPrimary: true, blocked: true } }
    }
  });
  res.json(users);
});

adminRouter.get("/users/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const take = Math.min(Number(req.query.take ?? 50) || 50, 200);
  const skip = Math.max(0, Number(req.query.skip ?? 0) || 0);
  const where: Prisma.UserWhereInput | undefined = q
    ? {
        OR: [
          { id: { contains: q, mode: "insensitive" as Prisma.QueryMode } },
          { referralCode: { contains: q, mode: "insensitive" as Prisma.QueryMode } },
          { email: { contains: q, mode: "insensitive" as Prisma.QueryMode } },
          {
            walletConnections: {
              some: { walletAddress: { contains: q, mode: "insensitive" as Prisma.QueryMode } }
            }
          }
        ]
      }
    : undefined;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        walletConnections: { select: { id: true, walletAddress: true, isPrimary: true, blocked: true } }
      }
    })
  ]);

  res.json({ rows, total, skip, take });
});

const backfillUserBody = z.object({
  walletAddress: z.string().min(16)
});

/** Admin utility: if wallet exists on-chain but missing in DB, create it so wallet login works. */
adminRouter.post("/users/backfill-from-chain", async (req: AuthRequest, res) => {
  const body = backfillUserBody.parse(req.body);
  const out = await backfillUserFromRegistrationWallet(prisma, body.walletAddress);
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "backfill_user_from_chain",
      targetType: "User",
      targetId: out.user.id,
      metadata: { walletAddress: body.walletAddress, created: out.created } as object
    }
  });
  res.status(out.created ? 201 : 200).json({
    created: out.created,
    user: {
      id: out.user.id,
      publicUserNumber: out.user.publicUserNumber,
      referralCode: out.user.referralCode,
      sponsorId: out.user.sponsorId,
      isActive: out.user.isActive,
      blockedReason: out.user.blockedReason ?? null,
      createdAt: out.user.createdAt
    }
  });
});

adminRouter.get("/reward-settings", async (_req, res) => {
  const settings = await prisma.rewardSetting.findMany({ orderBy: { key: "asc" } });
  res.json(settings);
});

adminRouter.patch("/reward-settings/:key", async (req: AuthRequest, res) => {
  const key = z.string().parse(req.params.key);
  const value = z.string().parse(req.body.value);
  const setting = await prisma.rewardSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "update_reward_setting",
      targetType: "RewardSetting",
      targetId: setting.id,
      metadata: { key, value }
    }
  });
  res.json(setting);
});

const settingsPatchSchema = z.object({
  settings: z.array(z.object({ key: z.string().min(1), value: z.string() }))
});

adminRouter.patch("/settings", async (req: AuthRequest, res) => {
  const body = settingsPatchSchema.parse(req.body);
  const results = [];
  for (const { key, value } of body.settings) {
    const setting = await prisma.rewardSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
    results.push(setting);
  }
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "bulk_update_settings",
      targetType: "RewardSetting",
      targetId: "bulk",
      metadata: { count: results.length }
    }
  });
  res.json(results);
});

adminRouter.get("/dashboard-content", async (_req, res) => {
  const row = await prisma.siteContent.findUnique({ where: { id: "default" } });
  res.json({
    payload: mergeDashboardPayload(row?.payload ?? {}),
    updatedAt: row?.updatedAt?.toISOString() ?? null
  });
});

adminRouter.patch("/dashboard-content", async (req: AuthRequest, res) => {
  const payloadRaw = (req.body as { payload?: unknown }).payload;
  if (payloadRaw === undefined || typeof payloadRaw !== "object" || payloadRaw === null) {
    return res.status(400).json({ message: "Body must include payload object" });
  }
  const merged = mergeDashboardPayload(payloadRaw);
  const row = await prisma.siteContent.upsert({
    where: { id: "default" },
    update: { payload: payloadToJsonValue(merged) },
    create: { id: "default", payload: payloadToJsonValue(merged) }
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "update_dashboard_content",
      targetType: "SiteContent",
      targetId: row.id,
      metadata: { keys: Object.keys(merged) }
    }
  });
  res.json({
    payload: mergeDashboardPayload(row.payload),
    updatedAt: row.updatedAt.toISOString()
  });
});

const dashboardAssetBody = z.object({
  filename: z.string().min(1),
  dataUrl: z.string().min(1)
});

adminRouter.post("/dashboard-assets", async (req: AuthRequest, res) => {
  const body = dashboardAssetBody.parse(req.body);
  const m = body.dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ message: "Invalid image data URL" });
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  const ext =
    mime === "image/jpeg"
      ? ".jpg"
      : mime === "image/png"
        ? ".png"
        : mime === "image/webp"
          ? ".webp"
          : mime === "image/gif"
            ? ".gif"
            : null;
  if (!ext) return res.status(400).json({ message: "Only png/jpg/webp/gif are supported" });

  const fileBytes = Buffer.from(b64, "base64");
  if (fileBytes.length > 8 * 1024 * 1024) {
    return res.status(413).json({ message: "Image too large (max 8MB)" });
  }

  const safeBase = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "");
  const outName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBase}${ext}`;
  const outDir = path.resolve(process.cwd(), "public", "dashboard-assets");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, outName), fileBytes);

  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "upload_dashboard_asset",
      targetType: "SiteContent",
      targetId: outName,
      metadata: { mime, size: fileBytes.length }
    }
  });
  res.status(201).json({ url: `/dashboard-assets/${outName}` });
});

const userStatusSchema = z.object({
  isActive: z.boolean().optional(),
  blockedReason: z.string().nullable().optional(),
  clearBlockedReason: z.boolean().optional()
});

adminRouter.patch("/users/:id/status", async (req: AuthRequest, res) => {
  const userId = z.string().min(1).parse(req.params.id);
  const body = userStatusSchema.parse(req.body);
  const data: {
    isActive?: boolean;
    inactiveSince?: Date | null;
    blockedReason?: string | null;
  } = {};
  if (body.isActive === false) {
    data.isActive = false;
    data.inactiveSince = new Date();
  } else if (body.isActive === true) {
    data.isActive = true;
    data.inactiveSince = null;
  }
  if (body.clearBlockedReason) {
    data.blockedReason = null;
  } else if (body.blockedReason !== undefined) {
    data.blockedReason = body.blockedReason;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "No status fields to update (send isActive, blockedReason, or clearBlockedReason)." });
  }
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data
    });
    await prisma.adminLog.create({
      data: {
        actorId: req.user!.sub,
        action: "update_user_status",
        targetType: "User",
        targetId: userId,
        metadata: body as object
      }
    });
    res.json(user);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return res.status(404).json({
        message:
          "User not found for this id. Paste the internal User id (cuid from the admin table’s id column), not the numeric User #."
      });
    }
    throw e;
  }
});

adminRouter.post("/users/:userId/wallets/:walletId/block", async (req: AuthRequest, res) => {
  const userId = z.string().min(1).parse(req.params.userId);
  const walletId = z.string().min(1).parse(req.params.walletId);
  const { blocked } = z.object({ blocked: z.boolean() }).parse(req.body);
  const wc = await prisma.walletConnection.findFirst({
    where: { id: walletId, userId }
  });
  if (!wc) return res.status(404).json({ message: "Wallet not found" });
  const updated = await prisma.walletConnection.update({
    where: { id: walletId },
    data: { blocked }
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "wallet_block_toggle",
      targetType: "WalletConnection",
      targetId: walletId,
      metadata: { userId, blocked }
    }
  });
  res.json(updated);
});

const sponsorRewireSchema = z.object({
  sponsorUserId: z.string().nullable()
});

adminRouter.post("/users/:id/sponsor", async (req: AuthRequest, res) => {
  const userId = z.string().min(1).parse(req.params.id);
  const { sponsorUserId } = sponsorRewireSchema.parse(req.body);
  if (sponsorUserId) {
    const sp = await prisma.user.findUnique({ where: { id: sponsorUserId } });
    if (!sp) return res.status(400).json({ message: "Sponsor user not found" });
  }
  const result = await referralService.rewireSponsorForLeafUser(userId, sponsorUserId);
  if (!result.ok) {
    return res.status(422).json({ message: result.reason });
  }
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "rewire_sponsor",
      targetType: "User",
      targetId: userId,
      metadata: { sponsorUserId }
    }
  });
  res.json({ ok: true });
});

const adminPackageSchema = z.object({
  tierId: z.string().min(1),
  runIncomeDistribution: z.boolean().optional(),
  reason: z.string().optional()
});

adminRouter.post("/users/:id/package", async (req: AuthRequest, res) => {
  const userId = z.string().min(1).parse(req.params.id);
  const body = adminPackageSchema.parse(req.body);
  const tier = await prisma.packageTier.findUnique({ where: { id: body.tierId } });
  if (!tier) return res.status(404).json({ message: "Tier not found" });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sponsorId: true }
  });
  if (!user) return res.status(404).json({ message: "User not found" });

  const activation = await prisma.$transaction(async (tx) => {
    await tx.packageActivation.updateMany({
      where: { userId, isCurrent: true },
      data: { isCurrent: false }
    });
    return tx.packageActivation.create({
      data: {
        userId,
        tierId: tier.id,
        isCurrent: true,
        onChain: false
      }
    });
  });

  if (body.runIncomeDistribution) {
    await rewardEngine.processActivationDistribution(
      userId,
      activation.id,
      Number(tier.activationAmount),
      user.sponsorId ?? undefined
    );
  }

  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "admin_package_activation",
      targetType: "PackageActivation",
      targetId: activation.id,
      metadata: {
        tierId: tier.id,
        runIncomeDistribution: Boolean(body.runIncomeDistribution),
        reason: body.reason ?? null
      }
    }
  });

  res.status(201).json(activation);
});

const freeOnChainRegSchema = z.object({
  userWallet: z.string().refine((a) => isAddress(a), "Invalid user wallet"),
  sponsorWallet: z.string().refine((a) => isAddress(a), "Invalid sponsor wallet"),
  packageId: z.coerce.number().int().min(1).max(11).optional()
});

/** Free on-chain register + activate (no USDT). Requires Registration owner/authorizer key. */
adminRouter.post("/chain/free-register-activate", superadminOnly, async (req: AuthRequest, res) => {
  const body = freeOnChainRegSchema.parse(req.body);
  const result = await adminFreeRegisterAndActivate(body);
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "admin_free_register_activate",
      targetType: "Registration",
      targetId: result.txHash,
      metadata: {
        userWallet: body.userWallet,
        sponsorWallet: body.sponsorWallet,
        packageId: result.packageId
      }
    }
  });
  res.json(result);
});

const freeOnChainUpgradeSchema = z.object({
  userWallet: z.string().refine((a) => isAddress(a), "Invalid user wallet"),
  packageId: z.coerce.number().int().min(2).max(11)
});

/** Free on-chain package upgrade (no USDT). */
adminRouter.post("/chain/free-upgrade", superadminOnly, async (req: AuthRequest, res) => {
  const body = freeOnChainUpgradeSchema.parse(req.body);
  const result = await adminFreeUpgrade(body);
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "admin_free_upgrade",
      targetType: "Registration",
      targetId: result.txHash,
      metadata: { userWallet: body.userWallet, packageId: result.packageId }
    }
  });
  res.json(result);
});

const botAdminSchema = z.object({ enabled: z.boolean() });

adminRouter.patch("/users/:id/auto-trade-bot", async (req: AuthRequest, res) => {
  const userId = z.string().min(1).parse(req.params.id);
  const { enabled } = botAdminSchema.parse(req.body);
  await prisma.user.update({
    where: { id: userId },
    data: { autoTradeBotEnabled: enabled }
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "admin_auto_trade_bot",
      targetType: "User",
      targetId: userId,
      metadata: { enabled }
    }
  });
  res.json({ enabled });
});

adminRouter.post("/users/:id/trade-now", async (req: AuthRequest, res) => {
  const userId = z.string().min(1).parse(req.params.id);
  const out = await runManualTradeForUser(userId, { triggeredBy: req.user!.sub });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "admin_manual_trade",
      targetType: "User",
      targetId: userId,
      metadata: out as object
    }
  });
  res.status(201).json(out);
});

adminRouter.post("/users/:id/reset-trading-limit", async (req: AuthRequest, res) => {
  const userId = z.string().min(1).parse(req.params.id);
  const out = await resetUserTradingLimit(userId);
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "admin_reset_trading_limit",
      targetType: "User",
      targetId: userId,
      metadata: out as object
    }
  });
  res.json(out);
});

adminRouter.get("/bot-purchase-runs", async (req, res) => {
  const take = Math.min(Number(req.query.take ?? 30) || 30, 100);
  const runs = await listBotPurchaseRuns(take);
  res.json(
    runs.map((r) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      triggeredBy: r.triggeredBy,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      summary: r.summary,
      attemptCount: r._count.attempts
    }))
  );
});

adminRouter.get("/bot-purchase-runs/:id", async (req, res) => {
  const id = z.string().min(1).parse(req.params.id);
  const run = await getBotPurchaseRunDetail(id);
  if (!run) {
    return res.status(404).json({ message: "Run not found" });
  }
  res.json({
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    summary: run.summary,
    attempts: run.attempts.map((a) => ({
      id: a.id,
      sortOrder: a.sortOrder,
      userId: a.userId,
      publicUserNumber: a.user.publicUserNumber,
      email: a.user.email,
      walletAddress: a.walletAddress,
      targetRemainingUsdt: Number(a.targetRemainingUsdt),
      balanceUsdt: Number(a.balanceUsdt),
      budgetUsdt: Number(a.budgetUsdt),
      tokenId: a.tokenId,
      effectivePayUsdt: a.effectivePayUsdt != null ? Number(a.effectivePayUsdt) : null,
      status: a.status,
      failureReason: a.failureReason,
      chainTxHash: a.chainTxHash,
      createdAt: a.createdAt.toISOString()
    }))
  });
});

adminRouter.post("/bot-purchase-runs/trigger", async (req: AuthRequest, res) => {
  const out = await runSequentialResaleBot({
    trigger: "admin",
    triggeredBy: req.user!.sub
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "bot_purchase_run_trigger",
      targetType: "BotPurchaseRun",
      targetId: out.runId,
      metadata: out as object
    }
  });
  res.status(201).json(out);
});

/** Reset every user's current-period daily allowance, then run the sequential NFT bot once. */
adminRouter.post("/reset-all-daily-limits-and-run-bot", async (req: AuthRequest, res) => {
  const out = await resetAllUsersDailyLimitAndRunBot({ triggeredBy: req.user!.sub });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "admin_reset_all_daily_limits_and_run_bot",
      targetType: "User",
      targetId: "all",
      metadata: out as object
    }
  });
  res.status(201).json(out);
});

adminRouter.post("/maintenance/recount-referrals", async (req: AuthRequest, res) => {
  const out = await referralService.recountAllUserStats();
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "recount_referrals",
      targetType: "User",
      targetId: "all",
      metadata: out as object
    }
  });
  res.json(out);
});

const tierCreateSchema = z.object({
  name: z.string().min(1),
  activationAmount: z.number().nonnegative(),
  tradingLimit: z.number().nonnegative(),
  sortOrder: z.number().int().optional(),
  isBaseEntry: z.boolean().optional(),
  isActive: z.boolean().optional()
});

const tierPatchSchema = tierCreateSchema.partial();

adminRouter.get("/package-tiers", async (_req, res) => {
  const tiers = await prisma.packageTier.findMany({ orderBy: { sortOrder: "asc" } });
  res.json(tiers);
});

adminRouter.post("/package-tiers", async (req: AuthRequest, res) => {
  const body = tierCreateSchema.parse(req.body);
  const tier = await prisma.packageTier.create({
    data: {
      name: body.name,
      activationAmount: body.activationAmount,
      tradingLimit: body.tradingLimit,
      sortOrder: body.sortOrder ?? 0,
      isBaseEntry: body.isBaseEntry ?? false,
      isActive: body.isActive ?? true
    }
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "create_package_tier",
      targetType: "PackageTier",
      targetId: tier.id,
      metadata: body as object
    }
  });
  res.status(201).json(tier);
});

adminRouter.patch("/package-tiers/:id", async (req: AuthRequest, res) => {
  const id = z.string().parse(req.params.id);
  const body = tierPatchSchema.parse(req.body);
  const tier = await prisma.packageTier.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.activationAmount !== undefined ? { activationAmount: body.activationAmount } : {}),
      ...(body.tradingLimit !== undefined ? { tradingLimit: body.tradingLimit } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isBaseEntry !== undefined ? { isBaseEntry: body.isBaseEntry } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
    }
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "update_package_tier",
      targetType: "PackageTier",
      targetId: id,
      metadata: body as object
    }
  });
  res.json(tier);
});

const chainEventsQuery = z.object({
  eventName: z.string().optional(),
  txHash: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).optional()
});

adminRouter.get("/chain-events", async (req, res) => {
  const q = chainEventsQuery.parse(req.query);
  const chainId = env.CHAIN_ID;
  const rows = await prisma.chainEvent.findMany({
    where: {
      chainId,
      ...(q.eventName ? { eventName: q.eventName } : {}),
      ...(q.txHash ? { txHash: q.txHash } : {})
    },
    orderBy: { blockNumber: "desc" },
    take: q.limit ?? 200
  });
  res.json(rows);
});

adminRouter.get("/nft-activity", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);

  const nftRows = await prisma.nFTRecord.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { mintedAt: "desc" },
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          referralCode: true,
          walletConnections: { where: { isPrimary: true }, take: 1 }
        }
      }
    }
  });

  const chainId = env.CHAIN_ID;
  const buyEvents = await prisma.chainEvent.findMany({
    where: { chainId, eventName: "Purchased" },
    orderBy: { blockNumber: "desc" },
    take: limit
  });

  res.json({ nftRecords: nftRows, chainBuyEvents: buyEvents });
});

adminRouter.get("/nft-activity/search", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const take = Math.min(Number(req.query.take ?? 50) || 50, 200);
  const skip = Math.max(0, Number(req.query.skip ?? 0) || 0);

  const where = userId ? { userId } : undefined;
  const chainId = env.CHAIN_ID;
  const buyWhere = { chainId, eventName: "Purchased" as const };

  const [nftTotal, eventTotal, nftRows, buyEvents] = await Promise.all([
    prisma.nFTRecord.count({ where }),
    prisma.chainEvent.count({ where: buyWhere }),
    prisma.nFTRecord.findMany({
      where,
      orderBy: { mintedAt: "desc" },
      skip,
      take,
      include: {
        user: {
          select: {
            id: true,
            referralCode: true,
            walletConnections: { where: { isPrimary: true }, take: 1 }
          }
        }
      }
    }),
    prisma.chainEvent.findMany({
      where: buyWhere,
      orderBy: { blockNumber: "desc" },
      skip,
      take
    })
  ]);

  res.json({
    nft: { rows: nftRows, total: nftTotal, skip, take },
    chainBuyEvents: { rows: buyEvents, total: eventTotal, skip, take }
  });
});

const onChainMintQuoteQuery = z.object({
  quantity: z.coerce.number().int().min(1).max(50)
});

const onChainMintPreflightQuery = z.object({
  recipient: z.string().optional()
});

adminRouter.get("/nft/on-chain-mint/defaults", (_req, res) => {
  res.json(adminNftMint.mintDefaults());
});

adminRouter.get("/nft/on-chain-mint/preflight", async (req, res) => {
  try {
    const { recipient } = onChainMintPreflightQuery.parse(req.query);
    const out = await adminNftMint.preflight(recipient);
    res.json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Preflight failed";
    res.status(500).json({ message, ready: false, issues: [message] });
  }
});

adminRouter.get("/nft/on-chain-mint/quote", async (req, res) => {
  try {
    const { quantity } = onChainMintQuoteQuery.parse(req.query);
    const quote = await adminNftMint.quote(quantity);
    res.json(quote);
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 400;
    const message = e instanceof Error ? e.message : "Quote failed";
    res.status(status >= 400 && status < 600 ? status : 500).json({ message });
  }
});

const onChainMintBody = z.object({
  recipient: z.string().optional(),
  quantity: z.number().int().min(1).max(50),
  label: z.string().max(200).optional()
});

adminRouter.post("/nft/on-chain-mint", superadminOnly, async (req: AuthRequest, res) => {
  try {
    const body = onChainMintBody.parse(req.body);
    const recipient = adminNftMint.resolveRecipient(body.recipient);
    const out = await adminNftMint.mintPrimaryToRecipient({
      recipient,
      quantity: body.quantity,
      label: body.label
    });
    await prisma.adminLog.create({
      data: {
        actorId: req.user!.sub,
        action: "nft_on_chain_mint",
        targetType: "NftMarketPlace",
        targetId: env.MARKETPLACE_CONTRACT_ADDRESS ?? "marketplace",
        metadata: {
          recipient,
          quantity: body.quantity,
          label: body.label ?? null,
          tokenIds: out.tokenIds,
          mintTxHashes: out.mintTxHashes,
          transferTxHash: out.transferTxHash
        } as object
      }
    });
    res.json({ ...out, recipient });
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 500;
    const message = e instanceof Error ? e.message : "On-chain mint failed";
    res.status(status >= 400 && status < 600 ? status : 500).json({ message });
  }
});

const adminMintPrimaryFreeBody = z.object({
  recipient: z.string().optional(),
  quantity: z.number().int().min(1).max(50),
  label: z.string().max(200).optional()
});

/** Admin or superadmin: owner-signed primary mint with no USDT (requires upgraded marketplace with `adminMintPrimaryNftFor`). */
adminRouter.post("/nft/admin-mint-primary-free", async (req: AuthRequest, res) => {
  try {
    const body = adminMintPrimaryFreeBody.parse(req.body);
    const recipient = adminNftMint.resolveRecipient(body.recipient);
    const out = await adminNftMint.mintAdminFreePrimaryToRecipient({
      recipient,
      quantity: body.quantity,
      label: body.label
    });
    await prisma.adminLog.create({
      data: {
        actorId: req.user!.sub,
        action: "nft_admin_mint_primary_free",
        targetType: "NftMarketPlace",
        targetId: env.MARKETPLACE_CONTRACT_ADDRESS ?? "marketplace",
        metadata: {
          recipient,
          quantity: body.quantity,
          label: body.label ?? null,
          tokenIds: out.tokenIds,
          mintTxHash: out.mintTxHash,
          transferTxHash: out.transferTxHash,
          listedOnMarket: out.listedOnMarket
        } as object
      }
    });
    res.json({ ...out, recipient });
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 500;
    const message = e instanceof Error ? e.message : "Admin free mint failed";
    res.status(status >= 400 && status < 600 ? status : 500).json({ message });
  }
});

const burnListedTokenIdQuery = z.object({
  tokenId: z.string().min(1).max(40)
});

adminRouter.get("/nft/on-chain-burn-listed/quote", async (req, res) => {
  try {
    const { tokenId } = burnListedTokenIdQuery.parse(req.query);
    const quote = await adminNftMint.quoteBurnListedNft(tokenId);
    res.json(quote);
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 400;
    const message = e instanceof Error ? e.message : "Quote failed";
    res.status(status >= 400 && status < 600 ? status : 500).json({ message });
  }
});

const burnListedBody = z.object({
  tokenId: z.union([z.string().min(1), z.number().int().positive()])
});

/**
 * Marketplace owner burns a **listed** resale: pays seller (USDT from owner wallet via `burnNftFromOwner`), same payout path as a buy.
 */
adminRouter.post("/nft/on-chain-burn-listed", async (req: AuthRequest, res) => {
  try {
    const body = burnListedBody.parse(req.body);
    const tokenId = String(body.tokenId);
    const out = await adminNftMint.burnListedNftByMarketplaceOwner(tokenId);
    await prisma.adminLog.create({
      data: {
        actorId: req.user!.sub,
        action: "nft_on_chain_burn_listed",
        targetType: "NftMarketPlace",
        targetId: env.MARKETPLACE_CONTRACT_ADDRESS ?? "marketplace",
        metadata: { tokenId, txHash: out.txHash } as object
      }
    });
    res.json(out);
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 500;
    const message = e instanceof Error ? e.message : "Burn listed NFT failed";
    res.status(status >= 400 && status < 600 ? status : 500).json({ message });
  }
});

const forceBurnTokenIdQuery = z.object({
  tokenId: z.string().min(1).max(40)
});

adminRouter.get("/nft/on-chain-force-burn/quote", async (req, res) => {
  try {
    const { tokenId } = forceBurnTokenIdQuery.parse(req.query);
    const quote = await adminNftMint.quoteForceBurnNft(tokenId);
    res.json(quote);
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 400;
    const message = e instanceof Error ? e.message : "Quote failed";
    res.status(status >= 400 && status < 600 ? status : 500).json({ message });
  }
});

const forceBurnBody = z.object({
  tokenId: z.union([z.string().min(1), z.number().int().positive()])
});

/** Marketplace owner `burnNftId`: burn any token id (no USDT; may desync listing state if still “for sale”). */
adminRouter.post("/nft/on-chain-force-burn", async (req: AuthRequest, res) => {
  try {
    const body = forceBurnBody.parse(req.body);
    const tokenId = String(body.tokenId);
    const out = await adminNftMint.forceBurnNftByMarketplaceOwner(tokenId);
    await prisma.adminLog.create({
      data: {
        actorId: req.user!.sub,
        action: "nft_on_chain_force_burn",
        targetType: "NftMarketPlace",
        targetId: env.MARKETPLACE_CONTRACT_ADDRESS ?? "marketplace",
        metadata: { tokenId, txHash: out.txHash } as object
      }
    });
    res.json(out);
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 500;
    const message = e instanceof Error ? e.message : "Force burn failed";
    res.status(status >= 400 && status < 600 ? status : 500).json({ message });
  }
});

adminRouter.get("/market-listings", async (_req, res) => {
  const rows = await prisma.marketNftListing.findMany({ orderBy: { sortOrder: "asc" } });
  res.json(rows);
});

const listingSchema = z.object({
  /** Omit to allocate the next free token # from the DB (avoids stale UI / duplicate inserts). */
  tokenNumber: z.number().int().positive().optional(),
  name: z.string().min(1),
  tier: z.string().min(1),
  priceUsdt: z.number().nonnegative(),
  /** Omit or empty: server assigns `nft-01.png`…`nft-10.png` from bundled assets by catalog token #. */
  imageFile: z.string().min(1).optional(),
  sortOrder: z.number().int().optional()
});

const CATALOG_TOKEN_NUMBER_FLOOR = 7300;

/** Filenames under `public/market-nfts/` shipped with the API. */
const CATALOG_NFT_IMAGE_FILES = [
  "nft-01.png",
  "nft-02.png",
  "nft-03.png",
  "nft-04.png",
  "nft-05.png",
  "nft-06.png",
  "nft-07.png",
  "nft-08.png",
  "nft-09.png",
  "nft-10.png"
] as const;

/** Stable mapping from catalog token # to a placeholder image (no client upload). */
function catalogImageFileForTokenNumber(tokenNumber: number): string {
  const idx = ((tokenNumber - 1) % CATALOG_NFT_IMAGE_FILES.length + CATALOG_NFT_IMAGE_FILES.length) % CATALOG_NFT_IMAGE_FILES.length;
  return CATALOG_NFT_IMAGE_FILES[idx]!;
}

adminRouter.post("/market-listings", async (req: AuthRequest, res) => {
  const raw = listingSchema.parse(req.body);
  const body = {
    ...raw,
    imageFile: raw.imageFile?.trim() || undefined
  };
  let tokenNumber: number;
  if (body.tokenNumber !== undefined) {
    tokenNumber = body.tokenNumber;
  } else {
    const agg = await prisma.marketNftListing.aggregate({ _max: { tokenNumber: true } });
    const hi = agg._max.tokenNumber ?? 0;
    tokenNumber = Math.max(hi, CATALOG_TOKEN_NUMBER_FLOOR) + 1;
  }
  const imageFile = body.imageFile || catalogImageFileForTokenNumber(tokenNumber);
  const sortOrder = body.sortOrder ?? tokenNumber;
  try {
    const row = await prisma.marketNftListing.create({
      data: {
        tokenNumber,
        name: body.name,
        tier: body.tier,
        priceUsdt: body.priceUsdt,
        imageFile,
        sortOrder
      }
    });
    await prisma.adminLog.create({
      data: {
        actorId: req.user!.sub,
        action: "create_market_listing",
        targetType: "MarketNftListing",
        targetId: row.id,
        metadata: { tokenNumber }
      }
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({
        message: `tokenNumber ${tokenNumber} is already used. Omit tokenNumber in the request body to auto-assign the next free catalog number.`
      });
    }
    throw e;
  }
});

adminRouter.patch("/market-listings/:id", async (req: AuthRequest, res) => {
  const id = z.string().parse(req.params.id);
  const body = listingSchema.partial().parse(req.body);
  const row = await prisma.marketNftListing.update({
    where: { id },
    data: body
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "update_market_listing",
      targetType: "MarketNftListing",
      targetId: id,
      metadata: body as object
    }
  });
  res.json(row);
});

adminRouter.delete("/market-listings/:id", async (req: AuthRequest, res) => {
  const id = z.string().parse(req.params.id);
  await prisma.marketNftListing.delete({ where: { id } });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "delete_market_listing",
      targetType: "MarketNftListing",
      targetId: id,
      metadata: {}
    }
  });
  res.status(204).send();
});

adminRouter.get("/contracts-env", (_req, res) => {
  res.json({
    chainId: env.CHAIN_ID,
    rpcUrlHost: new URL(env.CHAIN_RPC_URL).host,
    registration: env.REGISTRATION_CONTRACT_ADDRESS ?? null,
    marketplace: env.MARKETPLACE_CONTRACT_ADDRESS ?? null,
    rewards: env.REWARDS_CONTRACT_ADDRESS ?? null,
    globalPool: env.GLOBAL_POOL_CONTRACT_ADDRESS ?? null,
    treasury: env.TREASURY_CONTRACT_ADDRESS ?? null,
    liquidityManager: env.LIQUIDITY_MANAGER_CONTRACT_ADDRESS ?? null,
    usdt: env.USDT_CONTRACT_ADDRESS ?? null
  });
});

/** Testnet + mainnet deployment manifests, explorer links, and USDT balances per network. */
adminRouter.get("/networks-overview", async (_req, res) => {
  const out = await getAdminNetworksOverview();
  res.json(out);
});

/** USDT balance on each configured protocol contract (read-only). */
adminRouter.get("/contracts/usdt-balances", async (_req, res) => {
  const out = await contractRecovery.getUsdtBalances();
  res.json(out);
});

const recoverUsdtBody = z.object({
  target: z.enum([
    "registration",
    "marketplace",
    "rewards",
    "globalPool",
    "treasury",
    "liquidityManager"
  ]),
  /** Human amount (e.g. "10.5") or `"all"` for full on-chain balance. */
  amount: z.union([z.literal("all"), z.string().min(1)]).default("all")
});

adminRouter.post("/contracts/recover-usdt", superadminOnly, async (req: AuthRequest, res) => {
  const body = recoverUsdtBody.parse(req.body);
  const out = await contractRecovery.recoverUsdt(body.target, body.amount);
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "contract_recover_usdt",
      targetType: "Chain",
      targetId: out.txHash,
      metadata: { target: body.target, amount: body.amount, txHash: out.txHash }
    }
  });
  res.json(out);
});

const subscribeOwnerBody = z.object({
  userAddresses: z.array(z.string().refine((a) => isAddress(a), "invalid address")),
  referrerAddresses: z.array(z.string().refine((a) => isAddress(a), "invalid address")),
  level: z.number().int().min(1).max(255),
  isBlockBool: z.boolean().optional().default(false)
});

const registrationPlanUpdateBody = z.object({
  /** Package id index (1-based) to update. */
  index: z.coerce.number().int().min(1).max(255),
  /** Human USDT amount (18 decimals), e.g. 100. */
  planPrice: z.coerce.number().nonnegative(),
  /** Human limit amount (18 decimals), e.g. 1000. */
  planLimit: z.coerce.number().nonnegative(),
  holdingNft: z.coerce.number().int().nonnegative(),
  directCount: z.coerce.number().int().nonnegative(),
  /** Contract-wide total level after update. */
  newTotalLevel: z.coerce.number().int().min(1).max(255)
});

adminRouter.post("/registration/subscribe-owner", superadminOnly, async (req: AuthRequest, res) => {
  if (!registrationAdmin.isConfigured()) {
    return res.status(503).json({ message: "CONTRACT_ADMIN_PRIVATE_KEY or REGISTRATION_CONTRACT_ADDRESS not configured" });
  }
  const body = subscribeOwnerBody.parse(req.body);
  if (body.userAddresses.length !== body.referrerAddresses.length) {
    return res.status(400).json({ message: "userAddresses and referrerAddresses length mismatch" });
  }
  const out = await registrationAdmin.executeSubscribeOwner({
    userAddresses: body.userAddresses as `0x${string}`[],
    referrerAddresses: body.referrerAddresses as `0x${string}`[],
    level: body.level,
    isBlockBool: body.isBlockBool
  });
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "registration_subscribe_owner",
      targetType: "Chain",
      targetId: out.txHash,
      metadata: { ...body, txHash: out.txHash }
    }
  });
  res.json(out);
});

adminRouter.post("/registration/plan", superadminOnly, async (req: AuthRequest, res) => {
  if (!registrationAdmin.isConfigured()) {
    return res.status(503).json({ message: "CONTRACT_ADMIN_PRIVATE_KEY or REGISTRATION_CONTRACT_ADDRESS not configured" });
  }
  const body = registrationPlanUpdateBody.parse(req.body);
  const scale = 10n ** 18n;
  const planPriceWei = BigInt(Math.round(body.planPrice * 1e6)) * (scale / 1_000_000n);
  const planLimitWei = BigInt(Math.round(body.planLimit * 1e6)) * (scale / 1_000_000n);

  const out = await registrationAdmin.executeUpdatePlan({
    index: body.index,
    planPriceWei,
    planLimitWei,
    holdingNft: body.holdingNft,
    directCount: body.directCount,
    newTotalLevel: body.newTotalLevel
  });

  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "registration_plan_update",
      targetType: "Chain",
      targetId: out.txHash,
      metadata: {
        ...body,
        planPriceWei: planPriceWei.toString(),
        planLimitWei: planLimitWei.toString(),
        txHash: out.txHash
      }
    }
  });
  res.json(out);
});

adminRouter.get("/income-logs", async (_req, res) => {
  const rows = await prisma.incomeLedger.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
  res.json(rows);
});

adminRouter.get("/income", async (_req, res) => {
  const rows = await prisma.incomeLedger.findMany({
    include: { logs: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: { createdAt: "desc" },
    take: 1000
  });
  res.json(rows);
});

adminRouter.get("/trading-compliance", async (_req, res) => {
  const rows = await prisma.dailyTradingCompliance.findMany({ orderBy: { day: "desc" }, take: 1000 });
  res.json(rows);
});

adminRouter.get("/nfts", async (_req, res) =>
  res.json(await prisma.nFTRecord.findMany({ orderBy: { mintedAt: "desc" } }))
);
adminRouter.get("/ranks", async (_req, res) =>
  res.json(await prisma.rankHistory.findMany({ orderBy: { achievedAt: "desc" } }))
);
adminRouter.get("/burn-history", async (_req, res) =>
  res.json(await prisma.burnLog.findMany({ orderBy: { createdAt: "desc" } }))
);
adminRouter.get("/liquidity-history", async (_req, res) =>
  res.json(await prisma.liquidityLog.findMany({ orderBy: { createdAt: "desc" } }))
);

adminRouter.get("/admin-logs", async (req, res) => {
  const take = Math.min(Number(req.query.take ?? 200) || 200, 1000);
  const rows = await prisma.adminLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      actor: { select: { id: true, referralCode: true, email: true, role: true } }
    }
  });
  res.json(rows);
});

adminRouter.post("/chain/sync", async (req: AuthRequest, res) => {
  const out = await chainIndexer.syncRange();
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "chain_sync",
      targetType: "ChainSyncState",
      targetId: String(env.CHAIN_ID),
      metadata: out as object
    }
  });
  res.json(out);
});

/** Creates missing `IncomeLedger` rows for on-chain package activations (historical gap before indexer called reward engine). */
adminRouter.post("/rewards/backfill-on-chain-activations", async (req: AuthRequest, res) => {
  const limit = Math.min(Number((req.body as { limit?: unknown })?.limit ?? 500) || 500, 2000);
  const out = await backfillMissingOnChainActivationRewards(prisma, limit);
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "backfill_on_chain_activation_rewards",
      targetType: "IncomeLedger",
      targetId: "batch",
      metadata: out as object
    }
  });
  res.json(out);
});

const airdropPreviewBody = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("explicit"),
    tokenAddress: z.string().min(1),
    transfers: z.array(z.object({ to: z.string().min(1), amount: z.string().min(1) })).min(1)
  }),
  z.object({
    mode: z.literal("income_percent"),
    tokenAddress: z.string().min(1),
    percent: z.coerce.number().min(0.0001).max(100),
    lookbackDays: z.coerce.number().int().min(1).max(3650)
  })
]);

function jsonAirdropPreview(
  p: Awaited<ReturnType<typeof airdropAdmin.buildExplicit>> | Awaited<ReturnType<typeof airdropAdmin.buildIncomePercent>>
) {
  const total = airdropAdmin.totalWei(p).toString();
  if (p.mode === "explicit") {
    return {
      mode: p.mode,
      tokenAddress: p.tokenAddress,
      transfers: p.transfers.map((t) => ({
        to: t.to,
        amountHuman: t.amountHuman,
        amountWei: t.amountWei.toString()
      })),
      totalAmountWei: total
    };
  }
  return {
    mode: p.mode,
    tokenAddress: p.tokenAddress,
    percent: p.percent,
    lookbackDays: p.lookbackDays,
    transfers: p.transfers.map((t) => ({
      userId: t.userId,
      to: t.to,
      amountHuman: t.amountHuman,
      amountWei: t.amountWei.toString(),
      incomeSum: t.incomeSum
    })),
    totalAmountWei: total
  };
}

adminRouter.post("/airdrop/preview", async (req, res) => {
  const body = airdropPreviewBody.parse(req.body);
  if (body.mode === "explicit") {
    const p = await airdropAdmin.buildExplicit({ tokenAddress: body.tokenAddress, transfers: body.transfers });
    return res.json(jsonAirdropPreview(p));
  }
  const p = await airdropAdmin.buildIncomePercent({
    tokenAddress: body.tokenAddress,
    percent: body.percent,
    lookbackDays: body.lookbackDays
  });
  res.json(jsonAirdropPreview(p));
});

const airdropExecuteBody = z.object({
  confirm: z.literal(true),
  request: airdropPreviewBody
});

adminRouter.post("/airdrop/execute", superadminOnly, async (req: AuthRequest, res) => {
  const body = airdropExecuteBody.parse(req.body);
  const { request: r } = body;
  const preview =
    r.mode === "explicit"
      ? await airdropAdmin.buildExplicit({ tokenAddress: r.tokenAddress, transfers: r.transfers })
      : await airdropAdmin.buildIncomePercent({
          tokenAddress: r.tokenAddress,
          percent: r.percent,
          lookbackDays: r.lookbackDays
        });
  const out = await airdropAdmin.executeOnChain(preview, req.user!.sub);
  await prisma.adminLog.create({
    data: {
      actorId: req.user!.sub,
      action: "airdrop_execute",
      targetType: "AirdropRun",
      targetId: out.runId,
      metadata: {
        recipientCount: preview.mode === "explicit" ? preview.transfers.length : preview.transfers.length,
        tokenAddress: preview.tokenAddress,
        txHashes: out.txHashes
      } as object
    }
  });
  res.json(out);
});
