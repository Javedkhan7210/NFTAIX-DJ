import { Router } from "express";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/db/prisma.js";
import { ChainIndexerService } from "./chain-indexer.service.js";
import {
  globalPoolPayoutEnabled,
  readOnChainGlobalFundUsdt
} from "../ranks/global-pool-chain.service.js";
import { getPublicClient } from "./chain-viem.js";
import { requireAuth, type AuthRequest } from "../auth/auth.middleware.js";

const indexer = new ChainIndexerService(prisma);
export const chainRouter = Router();

/** Same env/RPC surface as getStatus but no Prisma — used if getStatus throws (e.g. missing DB grants). */
async function chainStatusWithoutDb(): Promise<
  Pick<
    Awaited<ReturnType<ChainIndexerService["getStatus"]>>,
    | "configured"
    | "onChainUiReady"
    | "missingOnChainConfig"
    | "rpcOk"
    | "chainId"
    | "latestBlock"
    | "usdt"
    | "registration"
    | "marketplace"
    | "rewards"
    | "globalPool"
    | "treasury"
    | "liquidityManager"
  >
> {
  const configured = Boolean(env.REGISTRATION_CONTRACT_ADDRESS);
  const missingOnChainConfig: string[] = [];
  if (!env.REGISTRATION_CONTRACT_ADDRESS) missingOnChainConfig.push("REGISTRATION_CONTRACT_ADDRESS");
  if (!env.USDT_CONTRACT_ADDRESS) missingOnChainConfig.push("USDT_CONTRACT_ADDRESS");
  if (!env.MARKETPLACE_CONTRACT_ADDRESS) missingOnChainConfig.push("MARKETPLACE_CONTRACT_ADDRESS");
  let rpcOk = false;
  let latestBlock: bigint | undefined;
  try {
    const client = getPublicClient();
    latestBlock = await client.getBlockNumber();
    rpcOk = true;
  } catch {
    rpcOk = false;
  }
  return {
    configured,
    onChainUiReady: missingOnChainConfig.length === 0,
    missingOnChainConfig,
    rpcOk,
    chainId: env.CHAIN_ID,
    latestBlock: latestBlock !== undefined ? latestBlock.toString() : undefined,
    usdt: env.USDT_CONTRACT_ADDRESS,
    registration: env.REGISTRATION_CONTRACT_ADDRESS,
    marketplace: env.MARKETPLACE_CONTRACT_ADDRESS,
    rewards: env.REWARDS_CONTRACT_ADDRESS,
    globalPool: env.GLOBAL_POOL_CONTRACT_ADDRESS,
    treasury: env.TREASURY_CONTRACT_ADDRESS,
    liquidityManager: env.LIQUIDITY_MANAGER_CONTRACT_ADDRESS
  };
}

const CHAIN_STATUS_API_REVISION = 2 as const;

chainRouter.get("/status", async (_req, res) => {
  try {
    const status = await indexer.getStatus();
    const globalPoolOnChain = await readOnChainGlobalFundUsdt();
    res.json({
      ...status,
      globalPoolOnChain,
      globalPoolOnChainPayoutEnabled: globalPoolPayoutEnabled(),
      chainStatusApiRevision: CHAIN_STATUS_API_REVISION
    });
  } catch (err) {
    logger.warn({ err }, "chain GET /status failed — returning env-only payload (no DB / partial reads)");
    const fallback = await chainStatusWithoutDb();
    res.json({
      ...fallback,
      lastSyncedBlock: undefined,
      chainStatusApiRevision: CHAIN_STATUS_API_REVISION,
      chainStatusDegraded: true,
      marketplaceEconomicsError:
        env.MARKETPLACE_CONTRACT_ADDRESS && fallback.rpcOk
          ? "Chain status degraded; marketplace economics skipped (see server logs)."
          : undefined
    });
  }
});

/** After an on-chain purchase/sale, index the tx and/or recent blocks so history updates immediately. */
chainRouter.post("/sync-recent", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.sub;
  const txHash =
    typeof req.body?.txHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(req.body.txHash)
      ? (req.body.txHash as `0x${string}`)
      : undefined;
  try {
    if (txHash) {
      const txSync = await indexer.syncMarketplaceTx(txHash);
      res.json({
        ok: true,
        txSync,
        processed: txSync.processed,
        fromBlock: "0",
        toBlock: "0",
        latestBlock: "0",
        gapBlocks: "0"
      });
      return;
    }
    const head = await indexer.syncMarketplaceHeadWindow();
    await indexer.ensureFreshUserMarketData(userId);
    res.json({ ok: true, txSync: { processed: 0 }, ...head });
  } catch (e) {
    logger.warn(e, "chain POST /sync-recent failed");
    res.status(500).json({ message: "Could not sync recent marketplace events." });
  }
});

chainRouter.get("/activation/:txHash", async (req, res) => {
  const txHash = req.params.txHash;
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ message: "Invalid tx hash." });
  }
  const result = await indexer.findActivationByTx(txHash);
  res.json(result);
});
