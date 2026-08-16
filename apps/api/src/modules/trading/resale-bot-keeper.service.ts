/**
 * Sequential bot keeper — NFTMarketplace runBot / botBuy (replaces legacy resale queue bot).
 */
import { BotPurchaseAttemptStatus, BotPurchaseRunStatus, Prisma } from "@prisma/client";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/db/prisma.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { marketplaceAbi } from "../chain/marketplace-abi.js";
import { registrationAbi } from "../chain/registration-abi.js";
import { runBotForWallet, runManualBotBuy } from "./auto-trade-keeper.service.js";

export type SequentialResaleBotResult = {
  runId: string;
  status: BotPurchaseRunStatus;
  usersProcessed: number;
  successes: number;
  failures: number;
  skipped: number;
};

export type ManualTradeForUserResult = {
  runId: string;
  status: BotPurchaseRunStatus;
  successes: number;
  failures: number;
  skipped: number;
  purchasesAttempted: number;
  failureReason: string | null;
  lastChainTxHash: string | null;
  lastTokenId: string | null;
};

function keeperConfigured(): boolean {
  return Boolean(
    env.AUTO_TRADE_EXECUTOR_PRIVATE_KEY?.trim() ||
      env.MARKETPLACE_OWNER_PRIVATE_KEY?.trim() ||
      env.CHAIN_PRIVATE_KEY?.trim()
  ) && Boolean(env.MARKETPLACE_CONTRACT_ADDRESS?.trim());
}

async function isBotEligibleWallet(walletAddr: `0x${string}`): Promise<{ ok: true } | { ok: false; reason: string }> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const reg = env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp || !reg) {
    return { ok: false, reason: "MARKETPLACE_CONTRACT_ADDRESS or REGISTRATION_CONTRACT_ADDRESS not set" };
  }

  const client = getPublicClient();
  try {
    const enabled = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "botEnabled",
      args: [walletAddr]
    });
    if (!enabled) {
      return { ok: false, reason: "User has not enabled marketplace bot (setUserBot)" };
    }

    const user = await client.readContract({
      address: reg,
      abi: registrationAbi,
      functionName: "users",
      args: [walletAddr]
    });
    if (!user[0] || !user[1]) {
      return { ok: false, reason: "Wallet not registered+activated on Registration" };
    }
    if (user[2]) {
      return { ok: false, reason: "Wallet is permanently inactive on Registration" };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "On-chain eligibility check failed" };
  }
}

/** Cron / admin trigger: runBot for each user with autoTradeBotEnabled. */
export async function runSequentialResaleBot(opts: {
  trigger: string;
  triggeredBy?: string;
}): Promise<SequentialResaleBotResult> {
  if (!keeperConfigured()) {
    const run = await prisma.botPurchaseRun.create({
      data: {
        status: BotPurchaseRunStatus.failed,
        trigger: opts.trigger,
        triggeredBy: opts.triggeredBy ?? null,
        finishedAt: new Date(),
        summary: { error: "AUTO_TRADE_EXECUTOR_PRIVATE_KEY or MARKETPLACE_CONTRACT_ADDRESS not set" }
      }
    });
    return {
      runId: run.id,
      status: BotPurchaseRunStatus.failed,
      usersProcessed: 0,
      successes: 0,
      failures: 0,
      skipped: 0
    };
  }

  const run = await prisma.botPurchaseRun.create({
    data: {
      status: BotPurchaseRunStatus.running,
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy ?? null
    }
  });

  let successes = 0;
  let failures = 0;
  let skipped = 0;
  let sortOrder = 0;
  const maxTrades = Math.max(1, env.BOT_SEQUENTIAL_MAX_PURCHASES_PER_USER);

  try {
    const users = await prisma.user.findMany({
      where: { autoTradeBotEnabled: true },
      orderBy: [{ publicUserNumber: "asc" }, { createdAt: "asc" }],
      select: { id: true, publicUserNumber: true }
    });

    for (const u of users) {
      const wallet = await prisma.walletConnection.findFirst({
        where: { userId: u.id, isPrimary: true },
        select: { walletAddress: true }
      });

      if (!wallet) {
        sortOrder += 1;
        skipped += 1;
        await prisma.botPurchaseAttempt.create({
          data: {
            runId: run.id,
            userId: u.id,
            sortOrder,
            walletAddress: null,
            targetRemainingUsdt: new Prisma.Decimal(0),
            balanceUsdt: new Prisma.Decimal(0),
            budgetUsdt: new Prisma.Decimal(0),
            status: BotPurchaseAttemptStatus.skipped,
            failureReason: "No primary wallet linked"
          }
        });
        continue;
      }

      const buyer = wallet.walletAddress as `0x${string}`;
      const eligibility = await isBotEligibleWallet(buyer);
      if (!eligibility.ok) {
        sortOrder += 1;
        skipped += 1;
        await prisma.botPurchaseAttempt.create({
          data: {
            runId: run.id,
            userId: u.id,
            sortOrder,
            walletAddress: wallet.walletAddress,
            targetRemainingUsdt: new Prisma.Decimal(0),
            balanceUsdt: new Prisma.Decimal(0),
            budgetUsdt: new Prisma.Decimal(0),
            status: BotPurchaseAttemptStatus.skipped,
            failureReason: eligibility.reason
          }
        });
        continue;
      }

      sortOrder += 1;
      try {
        const { txHash } = await runBotForWallet(buyer, maxTrades);
        successes += 1;
        await prisma.botPurchaseAttempt.create({
          data: {
            runId: run.id,
            userId: u.id,
            sortOrder,
            walletAddress: wallet.walletAddress,
            targetRemainingUsdt: new Prisma.Decimal(0),
            balanceUsdt: new Prisma.Decimal(0),
            budgetUsdt: new Prisma.Decimal(0),
            status: BotPurchaseAttemptStatus.success,
            chainTxHash: txHash
          }
        });
      } catch (e) {
        failures += 1;
        const reason = e instanceof Error ? e.message : String(e);
        await prisma.botPurchaseAttempt.create({
          data: {
            runId: run.id,
            userId: u.id,
            sortOrder,
            walletAddress: wallet.walletAddress,
            targetRemainingUsdt: new Prisma.Decimal(0),
            balanceUsdt: new Prisma.Decimal(0),
            budgetUsdt: new Prisma.Decimal(0),
            status: BotPurchaseAttemptStatus.failed,
            failureReason: reason
          }
        });
        logger.warn({ err: e, userId: u.id, buyer }, "sequential bot runBot failed");
      }
    }

    await prisma.botPurchaseRun.update({
      where: { id: run.id },
      data: {
        status: BotPurchaseRunStatus.completed,
        finishedAt: new Date(),
        summary: { usersProcessed: users.length, successes, failures, skipped, maxTrades }
      }
    });

    return {
      runId: run.id,
      status: BotPurchaseRunStatus.completed,
      usersProcessed: users.length,
      successes,
      failures,
      skipped
    };
  } catch (e) {
    await prisma.botPurchaseRun.update({
      where: { id: run.id },
      data: {
        status: BotPurchaseRunStatus.failed,
        finishedAt: new Date(),
        summary: { error: e instanceof Error ? e.message : String(e) }
      }
    });
    throw e;
  }
}

export async function runSequentialResaleBotOnce() {
  return runSequentialResaleBot({ trigger: "script" });
}

export async function runResaleBotKeeperOnce() {
  return runSequentialResaleBot({ trigger: "cron" });
}

/** Admin "Trade Now": runBot (or botBuy fallback) for one user. */
export async function runManualTradeForUser(
  userId: string,
  opts?: { triggeredBy?: string }
): Promise<ManualTradeForUserResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, autoTradeBotEnabled: true }
  });
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }
  if (!user.autoTradeBotEnabled) {
    throw Object.assign(new Error("Auto Trade is not enabled for this user"), { status: 400 });
  }
  if (!keeperConfigured()) {
    throw Object.assign(
      new Error("AUTO_TRADE_EXECUTOR_PRIVATE_KEY or MARKETPLACE_CONTRACT_ADDRESS not set"),
      { status: 500 }
    );
  }

  const run = await prisma.botPurchaseRun.create({
    data: {
      status: BotPurchaseRunStatus.running,
      trigger: "admin_manual",
      triggeredBy: opts?.triggeredBy ?? null
    }
  });

  const wallet = await prisma.walletConnection.findFirst({
    where: { userId, isPrimary: true },
    select: { walletAddress: true }
  });

  if (!wallet) {
    await prisma.botPurchaseAttempt.create({
      data: {
        runId: run.id,
        userId,
        sortOrder: 1,
        walletAddress: null,
        targetRemainingUsdt: new Prisma.Decimal(0),
        balanceUsdt: new Prisma.Decimal(0),
        budgetUsdt: new Prisma.Decimal(0),
        status: BotPurchaseAttemptStatus.skipped,
        failureReason: "No primary wallet linked"
      }
    });
    await prisma.botPurchaseRun.update({
      where: { id: run.id },
      data: {
        status: BotPurchaseRunStatus.completed,
        finishedAt: new Date(),
        summary: { manual: true, userId, successes: 0, failures: 0, skipped: 1 }
      }
    });
    return {
      runId: run.id,
      status: BotPurchaseRunStatus.completed,
      successes: 0,
      failures: 0,
      skipped: 1,
      purchasesAttempted: 0,
      failureReason: "No primary wallet linked",
      lastChainTxHash: null,
      lastTokenId: null
    };
  }

  const buyer = wallet.walletAddress as `0x${string}`;
  const maxTrades = env.ADMIN_MANUAL_TRADE_MAX_PURCHASES;
  let successes = 0;
  let failures = 0;
  let skipped = 0;
  let lastChainTxHash: string | null = null;
  let lastFailureReason: string | null = null;

  try {
    const eligibility = await isBotEligibleWallet(buyer);
    if (!eligibility.ok) {
      skipped = 1;
      lastFailureReason = eligibility.reason;
      await prisma.botPurchaseAttempt.create({
        data: {
          runId: run.id,
          userId,
          sortOrder: 1,
          walletAddress: wallet.walletAddress,
          targetRemainingUsdt: new Prisma.Decimal(0),
          balanceUsdt: new Prisma.Decimal(0),
          budgetUsdt: new Prisma.Decimal(0),
          status: BotPurchaseAttemptStatus.skipped,
          failureReason: eligibility.reason
        }
      });
    } else {
      try {
        const { txHash } = await runBotForWallet(buyer, maxTrades);
        successes = 1;
        lastChainTxHash = txHash;
        await prisma.botPurchaseAttempt.create({
          data: {
            runId: run.id,
            userId,
            sortOrder: 1,
            walletAddress: wallet.walletAddress,
            targetRemainingUsdt: new Prisma.Decimal(0),
            balanceUsdt: new Prisma.Decimal(0),
            budgetUsdt: new Prisma.Decimal(0),
            status: BotPurchaseAttemptStatus.success,
            chainTxHash: txHash
          }
        });
      } catch (e) {
        if (env.ADMIN_MANUAL_TRADE_PRIMARY_FALLBACK) {
          try {
            const { txHash } = await runManualBotBuy(buyer);
            successes = 1;
            lastChainTxHash = txHash;
            await prisma.botPurchaseAttempt.create({
              data: {
                runId: run.id,
                userId,
                sortOrder: 1,
                walletAddress: wallet.walletAddress,
                targetRemainingUsdt: new Prisma.Decimal(0),
                balanceUsdt: new Prisma.Decimal(0),
                budgetUsdt: new Prisma.Decimal(0),
                status: BotPurchaseAttemptStatus.success,
                chainTxHash: txHash,
                failureReason: "runBot failed; botBuy fallback succeeded"
              }
            });
          } catch (fallbackErr) {
            failures = 1;
            lastFailureReason =
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            await prisma.botPurchaseAttempt.create({
              data: {
                runId: run.id,
                userId,
                sortOrder: 1,
                walletAddress: wallet.walletAddress,
                targetRemainingUsdt: new Prisma.Decimal(0),
                balanceUsdt: new Prisma.Decimal(0),
                budgetUsdt: new Prisma.Decimal(0),
                status: BotPurchaseAttemptStatus.failed,
                failureReason: lastFailureReason
              }
            });
          }
        } else {
          failures = 1;
          lastFailureReason = e instanceof Error ? e.message : String(e);
          await prisma.botPurchaseAttempt.create({
            data: {
              runId: run.id,
              userId,
              sortOrder: 1,
              walletAddress: wallet.walletAddress,
              targetRemainingUsdt: new Prisma.Decimal(0),
              balanceUsdt: new Prisma.Decimal(0),
              budgetUsdt: new Prisma.Decimal(0),
              status: BotPurchaseAttemptStatus.failed,
              failureReason: lastFailureReason
            }
          });
        }
      }
    }

    const status =
      failures > 0 && successes === 0 ? BotPurchaseRunStatus.failed : BotPurchaseRunStatus.completed;

    await prisma.botPurchaseRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        summary: {
          manual: true,
          userId,
          successes,
          failures,
          skipped,
          maxTrades
        }
      }
    });

    return {
      runId: run.id,
      status,
      successes,
      failures,
      skipped,
      purchasesAttempted: successes + failures,
      failureReason: lastFailureReason,
      lastChainTxHash,
      lastTokenId: null
    };
  } catch (e) {
    await prisma.botPurchaseRun.update({
      where: { id: run.id },
      data: {
        status: BotPurchaseRunStatus.failed,
        finishedAt: new Date(),
        summary: { error: e instanceof Error ? e.message : String(e) }
      }
    });
    throw e;
  }
}

export async function getBotPurchaseRunDetail(runId: string) {
  return prisma.botPurchaseRun.findUnique({
    where: { id: runId },
    include: {
      attempts: {
        orderBy: { sortOrder: "asc" },
        include: {
          user: { select: { publicUserNumber: true, email: true } }
        }
      }
    }
  });
}

export async function listBotPurchaseRuns(take = 30) {
  return prisma.botPurchaseRun.findMany({
    take,
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { attempts: true } } }
  });
}

export { runManualBotBuy };
