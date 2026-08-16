import { ChainIndexerService } from "../modules/chain/chain-indexer.service.js";
import { runAutoTradeModuleKeeper } from "../modules/trading/auto-trade-module-keeper.service.js";
import { runAutoTradeKeeper, runAutoTradePrimaryBuys } from "../modules/trading/auto-trade-keeper.service.js";
import { runSequentialResaleBot } from "../modules/trading/resale-bot-keeper.service.js";
import { env } from "../shared/config/env.js";
import { NftDistributionService } from "../modules/nft/nft-distribution.service.js";
import { RankEngineService } from "../modules/ranks/rank-engine.service.js";
import { RewardEngineService } from "../modules/rewards/reward-engine.service.js";
import { prisma } from "../shared/db/prisma.js";
import { logger } from "../shared/logger.js";

const rewardEngine = new RewardEngineService(prisma);
const chainIndexer = new ChainIndexerService(prisma);
const rankEngine = new RankEngineService(prisma);
const nftDistribution = new NftDistributionService(prisma);
export async function runUnlockEligibleIncomes(): Promise<{ unlockedCount: number }> {
  return rewardEngine.unlockEligibleIncomes();
}

export async function runGlobalPoolDistribution(): Promise<unknown> {
  return rankEngine.persistGlobalPoolRun(new Date());
}

export async function runBurnNonCompliantLockedIncomes(): Promise<void> {
  const locked = await prisma.incomeLedger.findMany({
    where: { status: "locked" },
    take: 500
  });
  for (const row of locked) {
    const compliant = await rewardEngine.isUserTradingCompliantForDay(row.userId, row.createdAt);
    if (!compliant) {
      await prisma.$transaction([
        prisma.incomeLedger.update({
          where: { id: row.id },
          data: { status: "burned" }
        }),
        prisma.incomeLog.create({
          data: {
            incomeId: row.id,
            fromStatus: "locked",
            toStatus: "burned",
            reason: "trading_non_compliant"
          }
        })
      ]);
    }
  }
}

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

export async function runChainIndexer(): Promise<unknown> {
  if (!chainIndexer.isConfigured()) {
    return { skipped: true };
  }
  try {
    const r = await chainIndexer.syncRange();
    return r;
  } catch (e) {
    logger.error(e, "chain indexer");
    throw e;
  }
}

export async function runAutoTradeKeeperJob() {
  const sequential = await runSequentialResaleBot({ trigger: "cron" });

  if (!env.LEGACY_AUTO_TRADE_KEEPER) {
    return { sequential };
  }

  let moduleOut: Awaited<ReturnType<typeof runAutoTradeModuleKeeper>>;
  try {
    moduleOut = await runAutoTradeModuleKeeper();
  } catch (e) {
    logger.warn(e, "auto-trade module keeper failed (continuing marketplace + primary)");
    moduleOut = {
      skipped: `module keeper error: ${e instanceof Error ? e.message : String(e)}`
    };
  }

  const marketplaceOut = await runAutoTradeKeeper();
  const primaryOut = await runAutoTradePrimaryBuys();
  return { sequential, module: moduleOut, marketplace: marketplaceOut, primary: primaryOut };
}

export async function runInactivityDeactivation(): Promise<{ deactivated: number }> {
  const cutoff = new Date(Date.now() - TEN_DAYS_MS);
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true }
  });
  let deactivated = 0;
  for (const u of users) {
    const last = await prisma.tradingLog.findFirst({
      where: { userId: u.id },
      orderBy: { tradeDate: "desc" }
    });
    // Users who never logged a trade must not be treated as "inactive" — only absent recent activity.
    if (!last) {
      continue;
    }
    if (last.tradeDate < cutoff) {
      await prisma.user.update({
        where: { id: u.id },
        data: { isActive: false, inactiveSince: new Date() }
      });
      await nftDistribution.burnAllUserNfts(u.id, "account_inactive_no_trading_10_days");
      deactivated += 1;
    }
  }
  return { deactivated };
}
