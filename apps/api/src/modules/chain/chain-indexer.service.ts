import { Prisma, type PrismaClient } from "@prisma/client";
import { decodeEventLog, formatEther, parseAbi } from "viem";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";
import {
  activatedEvent,
  listedEvent,
  marketplaceAbi,
  purchasedEvent,
  registeredEvent,
  upgradedEvent
} from "./chain-abis.js";
import { getLogsChunked } from "./chain-get-logs-chunked.js";
import { chainEventLogRef, indexedLogFields } from "./chain-log-utils.js";
import { getPublicClient } from "./chain-viem.js";
import { RewardEngineService } from "../rewards/reward-engine.service.js";
import { effectiveActivationSponsorId } from "../rewards/on-chain-sponsor.js";
import { TradingComplianceService } from "../trading/trading-compliance.service.js";
import { getDailyVolumeDivisor } from "../trading/trading-divisor.js";
import {
  getGlobalDailyVolumeSince,
  getTradingPeriodBounds,
  isTradeDateInCurrentPeriod
} from "../trading/trading-period.js";
import { userDayTradingLogWhere } from "../trading/trading-volume-scope.js";
import { syncUserPackageIncomeMetrics } from "../income/package-income-metrics.service.js";
import { PACKAGE_USD_BY_ID } from "../packages/package-usd.js";
import {
  backfillMarketplacePurchasedIncomeForUser,
  indexMarketplacePurchasedIncome
} from "./marketplace-purchased-income.js";

function normalizeAddr(a: string): string {
  return a.trim().toLowerCase();
}

function normalizeTxHash(h: string): string {
  return h.trim().toLowerCase();
}

/** Idempotent volume row for one on-chain NFT purchase. */
async function tradingLogExistsForChainPurchase(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  txHash: string,
  relatedTokenId: string
): Promise<boolean> {
  const existing = await db.tradingLog.findFirst({
    where: {
      userId,
      chainTxHash: normalizeTxHash(txHash),
      relatedTokenId: String(relatedTokenId)
    },
    select: { id: true }
  });
  return Boolean(existing);
}

async function createTradingLogIdempotent(
  db: PrismaClient | Prisma.TransactionClient,
  data: {
    userId: string;
    packageActivationId: string;
    tradeDate: Date;
    volume: Prisma.Decimal;
    allowedDailyVolume: Prisma.Decimal;
    chainTxHash: string;
    relatedTokenId: string;
  }
): Promise<boolean> {
  if (await tradingLogExistsForChainPurchase(db, data.userId, data.chainTxHash, data.relatedTokenId)) {
    return false;
  }
  try {
    await db.tradingLog.create({
      data: {
        ...data,
        chainTxHash: normalizeTxHash(data.chainTxHash),
        relatedTokenId: String(data.relatedTokenId)
      }
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

function jsonPayload(obj: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  ) as Prisma.InputJsonValue;
}

type ChainEventInsertRow = {
  chainId: number;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  contract: string;
  eventName: string;
  payload: Prisma.InputJsonValue;
};

function insertChainEventSkipDup(db: PrismaClient | Prisma.TransactionClient, row: ChainEventInsertRow) {
  return db.chainEvent.createMany({
    data: [
      {
        chainId: row.chainId,
        blockNumber: row.blockNumber,
        logIndex: row.logIndex,
        txHash: row.txHash,
        contract: row.contract,
        eventName: row.eventName,
        payload: row.payload
      }
    ],
    skipDuplicates: true
  });
}

let lastHeadWindowSyncAt = 0;
const HEAD_WINDOW_SYNC_MIN_INTERVAL_MS = 15_000;
const usdtReadAbi = parseAbi(["function usdt() view returns (address)"]);

const USER_MARKET_DATA_FRESH_MS = 45_000;

export class ChainIndexerService {
  private readonly userMarketDataFreshUntil = new Map<string, number>();

  constructor(private readonly prisma: PrismaClient) {}

  /** Registration contract only (new stack). */
  private registrationAddress(): `0x${string}` | undefined {
    const a = env.REGISTRATION_CONTRACT_ADDRESS;
    return a as `0x${string}` | undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.registrationAddress());
  }

  /** Live NFTMarketplace pricing (new stack). */
  private async readMarketplaceEconomics(): Promise<{
    nextListPrice: string;
    mintPrice: string;
    burnThreshold: string;
    queueLength: string;
    sellPercent: string;
    sellPercentWei: string;
    maxSalePrice: string;
    maxSalePriceWei: string;
    nftBurnBasePrice: string;
    nftBurnBasePriceWei: string;
    mintNftCount: string;
    mintNftCountNum: number;
    nftOwnerIncomePercent: string;
    levelIncomePercent: string;
    buringIncomePercent: string;
    lpIncomePercent: string;
    platformIncomePercent: string;
  } | null> {
    const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
    if (!mp) return null;
    try {
      const client = getPublicClient();
      const [nextListPrice, mintPrice, burnThreshold, queueLength] = await Promise.all([
        client.readContract({ address: mp, abi: marketplaceAbi, functionName: "nextListPrice" }),
        client.readContract({ address: mp, abi: marketplaceAbi, functionName: "mintPrice" }),
        client.readContract({ address: mp, abi: marketplaceAbi, functionName: "burnThreshold" }),
        client.readContract({ address: mp, abi: marketplaceAbi, functionName: "queueLength" })
      ]);
      return {
        nextListPrice: formatEther(nextListPrice),
        mintPrice: formatEther(mintPrice),
        burnThreshold: formatEther(burnThreshold),
        queueLength: queueLength.toString(),
        sellPercent: "10",
        sellPercentWei: "10",
        maxSalePrice: formatEther(burnThreshold),
        maxSalePriceWei: burnThreshold.toString(),
        nftBurnBasePrice: formatEther(burnThreshold),
        nftBurnBasePriceWei: burnThreshold.toString(),
        mintNftCount: "0",
        mintNftCountNum: 0,
        nftOwnerIncomePercent: "30",
        levelIncomePercent: "20",
        buringIncomePercent: "25",
        lpIncomePercent: "10",
        platformIncomePercent: "5"
      };
    } catch (e) {
      logger.warn({ err: e }, "readMarketplaceEconomics failed");
      return null;
    }
  }

  async getStatus(): Promise<{
    configured: boolean;
    onChainUiReady: boolean;
    missingOnChainConfig: string[];
    rpcOk: boolean;
    chainId: number;
    latestBlock?: string;
    lastSyncedBlock?: string;
    usdt?: string;
    registrationUsdtOnChain?: string;
    registration?: string;
    marketplace?: string;
    marketplaceUsdtOnChain?: string;
    rewards?: string;
    globalPool?: string;
    treasury?: string;
    liquidityManager?: string;
    usdtMismatchError?: string;
    marketplaceEconomics?: Exclude<Awaited<ReturnType<ChainIndexerService["readMarketplaceEconomics"]>>, null>;
    marketplaceEconomicsError?: string;
  }> {
    const configured = this.isConfigured();
    const missingOnChainConfig: string[] = [];
    const required: Array<[string, string | undefined]> = [
      ["REGISTRATION_CONTRACT_ADDRESS", env.REGISTRATION_CONTRACT_ADDRESS],
      ["USDT_CONTRACT_ADDRESS", env.USDT_CONTRACT_ADDRESS],
      ["MARKETPLACE_CONTRACT_ADDRESS", env.MARKETPLACE_CONTRACT_ADDRESS],
      ["REWARDS_CONTRACT_ADDRESS", env.REWARDS_CONTRACT_ADDRESS],
      ["GLOBAL_POOL_CONTRACT_ADDRESS", env.GLOBAL_POOL_CONTRACT_ADDRESS],
      ["TREASURY_CONTRACT_ADDRESS", env.TREASURY_CONTRACT_ADDRESS],
      ["LIQUIDITY_MANAGER_CONTRACT_ADDRESS", env.LIQUIDITY_MANAGER_CONTRACT_ADDRESS]
    ];
    for (const [name, val] of required) {
      if (!val) missingOnChainConfig.push(name);
    }
    let onChainUiReady = missingOnChainConfig.length === 0;

    let rpcOk = false;
    let latestBlock: bigint | undefined;
    try {
      const client = getPublicClient();
      latestBlock = await client.getBlockNumber();
      rpcOk = true;
    } catch {
      rpcOk = false;
    }

    const client = rpcOk ? getPublicClient() : null;
    const registration = this.registrationAddress();
    const marketplace = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
    let registrationUsdtOnChain: string | undefined;
    let marketplaceUsdtOnChain: string | undefined;
    let usdtMismatchError: string | undefined;
    if (client && env.USDT_CONTRACT_ADDRESS) {
      try {
        if (registration) {
          registrationUsdtOnChain = (await client.readContract({
            address: registration,
            abi: usdtReadAbi,
            functionName: "usdt"
          })) as string;
        }
        if (marketplace) {
          marketplaceUsdtOnChain = (await client.readContract({
            address: marketplace,
            abi: usdtReadAbi,
            functionName: "usdt"
          })) as string;
        }

        const envUsdt = normalizeAddr(env.USDT_CONTRACT_ADDRESS);
        const mismatches: string[] = [];
        if (registrationUsdtOnChain && normalizeAddr(registrationUsdtOnChain) !== envUsdt) {
          mismatches.push(`registration uses ${registrationUsdtOnChain}`);
        }
        if (marketplaceUsdtOnChain && normalizeAddr(marketplaceUsdtOnChain) !== envUsdt) {
          mismatches.push(`marketplace uses ${marketplaceUsdtOnChain}`);
        }
        if (mismatches.length) {
          usdtMismatchError = `USDT mismatch: env USDT_CONTRACT_ADDRESS=${env.USDT_CONTRACT_ADDRESS} but ${mismatches.join(
            " and "
          )}. Align env with on-chain usdt().`;
          onChainUiReady = false;
        }
      } catch (e) {
        logger.warn({ err: e }, "chain status: usdt() sanity check failed");
      }
    }

    const row = await this.prisma.chainSyncState.findUnique({ where: { chainId: env.CHAIN_ID } });
    let marketplaceEconomics: Awaited<ReturnType<ChainIndexerService["readMarketplaceEconomics"]>> | undefined;
    let marketplaceEconomicsError: string | undefined;
    if (env.MARKETPLACE_CONTRACT_ADDRESS && rpcOk) {
      const econ = await this.readMarketplaceEconomics();
      if (econ) marketplaceEconomics = econ;
      else marketplaceEconomicsError = "Could not read marketplace economics (see server logs).";
    }
    return {
      configured,
      onChainUiReady,
      missingOnChainConfig,
      rpcOk,
      chainId: env.CHAIN_ID,
      latestBlock: latestBlock !== undefined ? latestBlock.toString() : undefined,
      lastSyncedBlock: row ? row.lastBlock.toString() : undefined,
      usdt: env.USDT_CONTRACT_ADDRESS,
      ...(registrationUsdtOnChain ? { registrationUsdtOnChain } : {}),
      registration: env.REGISTRATION_CONTRACT_ADDRESS,
      marketplace: env.MARKETPLACE_CONTRACT_ADDRESS,
      ...(marketplaceUsdtOnChain ? { marketplaceUsdtOnChain } : {}),
      rewards: env.REWARDS_CONTRACT_ADDRESS,
      globalPool: env.GLOBAL_POOL_CONTRACT_ADDRESS,
      treasury: env.TREASURY_CONTRACT_ADDRESS,
      liquidityManager: env.LIQUIDITY_MANAGER_CONTRACT_ADDRESS,
      ...(usdtMismatchError ? { usdtMismatchError } : {}),
      ...(marketplaceEconomics ? { marketplaceEconomics } : {}),
      ...(marketplaceEconomicsError ? { marketplaceEconomicsError } : {})
    };
  }

  async syncRange(): Promise<{ processed: number; fromBlock: string; toBlock: string } | { skipped: string }> {
    const registration = this.registrationAddress();
    if (!registration) return { skipped: "REGISTRATION_CONTRACT_ADDRESS not set" };

    const client = getPublicClient();
    const latest = await client.getBlockNumber();
    const state = await this.prisma.chainSyncState.findUnique({ where: { chainId: env.CHAIN_ID } });
    const from =
      state?.lastBlock !== undefined ? state.lastBlock + 1n : env.CHAIN_START_BLOCK ?? (latest > 2000n ? latest - 2000n : 0n);
    if (from > latest) {
      return { processed: 0, fromBlock: from.toString(), toBlock: latest.toString() };
    }
    const chunk = 500n;
    const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;

    let processed = 0;
    processed += await this.processRegistrationLogsForBlockRange(client, registration, from, to);
    processed += await this.processMarketplaceLogsForBlockRange(client, from, to);

    await this.prisma.chainSyncState.upsert({
      where: { chainId: env.CHAIN_ID },
      create: { chainId: env.CHAIN_ID, lastBlock: to },
      update: { lastBlock: to }
    });

    return { processed, fromBlock: from.toString(), toBlock: to.toString() };
  }

  /** Index a single marketplace tx immediately after MetaMask buy/list. */
  async syncMarketplaceTx(txHash: `0x${string}`): Promise<{ processed: number }> {
    const mpAddr = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
    if (!mpAddr) return { processed: 0 };

    const client = getPublicClient();
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const tradeDate = new Date(Number(block.timestamp) * 1000);
    const mpL = mpAddr.toLowerCase();
    let processed = 0;

    for (const lg of receipt.logs) {
      if (String(lg.address).toLowerCase() !== mpL) continue;
      try {
        const decoded = decodeEventLog({
          abi: [purchasedEvent, listedEvent],
          data: lg.data,
          topics: lg.topics as [`0x${string}`, ...`0x${string}`[]]
        });
        const logIndex = Number(lg.logIndex);
        const exists = await this.prisma.chainEvent.findUnique({
          where: {
            chainId_txHash_logIndex: {
              chainId: env.CHAIN_ID,
              txHash,
              logIndex
            }
          }
        });
        if (exists) {
          await this.repairTradingLogChainTxFromIndexedEvent(exists);
          continue;
        }

        if (decoded.eventName === "Purchased") {
          const args = decoded.args as {
            buyer: `0x${string}`;
            tokenId: bigint;
            price: bigint;
          };
          await this.persistPurchased(
            { buyer: args.buyer, tokenId: args.tokenId, price: args.price },
            tradeDate,
            txHash,
            {
              address: lg.address,
              blockNumber: receipt.blockNumber,
              logIndex,
              transactionHash: txHash
            }
          );
          processed += 1;
        } else if (decoded.eventName === "Listed") {
          const args = decoded.args as { tokenId: bigint; price: bigint };
          await this.persistListed(
            { tokenId: args.tokenId, price: args.price },
            {
              address: lg.address,
              blockNumber: receipt.blockNumber,
              logIndex,
              transactionHash: txHash
            }
          );
          processed += 1;
        }
      } catch {
        /* not a marketplace event log */
      }
    }

    return { processed };
  }

  async syncMarketplaceHeadWindow(lookbackBlocks = 1_200n): Promise<{
    processed: number;
    fromBlock: string;
    toBlock: string;
    latestBlock: string;
    gapBlocks: string;
    skippedThrottle?: boolean;
  }> {
    const mpAddr = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
    if (!mpAddr) {
      return { processed: 0, fromBlock: "0", toBlock: "0", latestBlock: "0", gapBlocks: "0" };
    }
    const now = Date.now();
    if (now - lastHeadWindowSyncAt < HEAD_WINDOW_SYNC_MIN_INTERVAL_MS) {
      const client = getPublicClient();
      const latest = await client.getBlockNumber();
      const state = await this.prisma.chainSyncState.findUnique({ where: { chainId: env.CHAIN_ID } });
      const gap = state ? latest - state.lastBlock : 0n;
      return {
        processed: 0,
        fromBlock: "0",
        toBlock: latest.toString(),
        latestBlock: latest.toString(),
        gapBlocks: gap.toString(),
        skippedThrottle: true
      };
    }
    lastHeadWindowSyncAt = now;

    const client = getPublicClient();
    const latest = await client.getBlockNumber();
    const state = await this.prisma.chainSyncState.findUnique({ where: { chainId: env.CHAIN_ID } });
    const gap = state ? latest - state.lastBlock : 0n;
    const from = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;
    const chunk = 400n;
    let processed = 0;
    for (let start = from; start <= latest; start += chunk) {
      const end = start + chunk - 1n > latest ? latest : start + chunk - 1n;
      processed += await this.processMarketplaceLogsForBlockRange(client, start, end);
    }
    return {
      processed,
      fromBlock: from.toString(),
      toBlock: latest.toString(),
      latestBlock: latest.toString(),
      gapBlocks: gap.toString()
    };
  }

  /** Head sync + per-user ledger repair before NFT/trading history API reads. */
  async ensureFreshUserMarketData(userId: string, opts?: { force?: boolean }): Promise<void> {
    const now = Date.now();
    const freshUntil = this.userMarketDataFreshUntil.get(userId) ?? 0;
    if (!opts?.force && now < freshUntil) return;
    this.userMarketDataFreshUntil.set(userId, now + USER_MARKET_DATA_FRESH_MS);
    try {
      await this.syncMarketplaceHeadWindow();
    } catch (e) {
      logger.warn(e, "chain-indexer: syncMarketplaceHeadWindow");
    }
    try {
      await this.backfillTradingLogsFromChainEventsForUser(userId);
    } catch (e) {
      logger.warn(e, "chain-indexer: backfillTradingLogsFromChainEventsForUser");
    }
  }

  private async processRegistrationLogsForBlockRange(
    client: ReturnType<typeof getPublicClient>,
    registration: `0x${string}`,
    from: bigint,
    to: bigint
  ): Promise<number> {
    let processed = 0;
    const blockTs = new Map<bigint, Date>();
    const blockTime = async (bn: bigint) => {
      const hit = blockTs.get(bn);
      if (hit) return hit;
      const b = await client.getBlock({ blockNumber: bn });
      const d = new Date(Number(b.timestamp) * 1000);
      blockTs.set(bn, d);
      return d;
    };

    for (const event of [registeredEvent, activatedEvent, upgradedEvent] as const) {
      const logs = await getLogsChunked(client, { address: registration, event }, from, to);
      for (const log of logs) {
        const idx = indexedLogFields(log);
        if (!idx) continue;
        const { txHash, logIndex, blockNumber } = idx;
        const logRef = chainEventLogRef(idx);

        const exists = await this.prisma.chainEvent.findUnique({
          where: {
            chainId_txHash_logIndex: {
              chainId: env.CHAIN_ID,
              txHash,
              logIndex
            }
          }
        });
        if (exists) continue;

        if (log.eventName === "Registered") {
          const args = log.args;
          if (!args?.user || !args?.sponsor) continue;
          await this.persistChainEventOnly(registration, "Registered", logRef, {
            user: args.user,
            sponsor: args.sponsor
          });
          processed += 1;
        } else if (log.eventName === "Activated") {
          const args = log.args;
          if (
            args?.user === undefined ||
            args?.packageId === undefined ||
            args?.price === undefined ||
            args?.tradingLimit === undefined
          ) {
            continue;
          }
          const tradeDate = await blockTime(blockNumber);
          await this.persistActivated(
            {
              user: args.user as `0x${string}`,
              packageId: Number(args.packageId),
              price: args.price as bigint,
              tradingLimit: args.tradingLimit as bigint
            },
            txHash,
            { ...logRef, address: log.address },
            tradeDate
          );
          processed += 1;
        } else if (log.eventName === "Upgraded") {
          const args = log.args;
          if (
            args?.user === undefined ||
            args?.oldPackageId === undefined ||
            args?.newPackageId === undefined ||
            args?.price === undefined ||
            args?.tradingLimit === undefined
          ) {
            continue;
          }
          const tradeDate = await blockTime(blockNumber);
          await this.persistUpgraded(
            {
              user: args.user as `0x${string}`,
              oldPackageId: Number(args.oldPackageId),
              newPackageId: Number(args.newPackageId),
              price: args.price as bigint,
              tradingLimit: args.tradingLimit as bigint
            },
            txHash,
            { ...logRef, address: log.address },
            tradeDate
          );
          processed += 1;
        }
      }
    }

    return processed;
  }

  private async processMarketplaceLogsForBlockRange(
    client: ReturnType<typeof getPublicClient>,
    from: bigint,
    to: bigint
  ): Promise<number> {
    const mpAddr = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
    if (!mpAddr) return 0;

    let processed = 0;
    const blockTs = new Map<bigint, Date>();
    const blockTime = async (bn: bigint) => {
      const hit = blockTs.get(bn);
      if (hit) return hit;
      const b = await client.getBlock({ blockNumber: bn });
      const d = new Date(Number(b.timestamp) * 1000);
      blockTs.set(bn, d);
      return d;
    };

    const purchasedLogs = await getLogsChunked(client, { address: mpAddr, event: purchasedEvent }, from, to);
    for (const log of purchasedLogs) {
      const idx = indexedLogFields(log);
      if (!idx) continue;
      const { txHash, logIndex, blockNumber } = idx;

      const exists = await this.prisma.chainEvent.findUnique({
        where: {
          chainId_txHash_logIndex: {
            chainId: env.CHAIN_ID,
            txHash,
            logIndex
          }
        }
      });
      if (exists) {
        await this.repairTradingLogChainTxFromIndexedEvent(exists);
        continue;
      }

      if (log.eventName !== "Purchased") continue;
      const args = log.args;
      if (!args?.buyer || args.tokenId === undefined || args.price === undefined) continue;

      const tradeDate = await blockTime(blockNumber);
      await this.persistPurchased(
        {
          buyer: args.buyer as `0x${string}`,
          tokenId: args.tokenId as bigint,
          price: args.price as bigint
        },
        tradeDate,
        txHash,
        {
          address: log.address,
          blockNumber,
          logIndex,
          transactionHash: txHash
        }
      );
      processed += 1;
    }

    const listedLogs = await getLogsChunked(client, { address: mpAddr, event: listedEvent }, from, to);
    for (const log of listedLogs) {
      const idx = indexedLogFields(log);
      if (!idx) continue;
      const { txHash, logIndex, blockNumber } = idx;

      const exists = await this.prisma.chainEvent.findUnique({
        where: {
          chainId_txHash_logIndex: {
            chainId: env.CHAIN_ID,
            txHash,
            logIndex
          }
        }
      });
      if (exists) continue;

      if (log.eventName !== "Listed") continue;
      const args = log.args;
      if (args?.tokenId === undefined || args?.price === undefined) continue;

      await this.persistListed(
        { tokenId: args.tokenId as bigint, price: args.price as bigint },
        {
          address: log.address,
          blockNumber,
          logIndex,
          transactionHash: txHash
        }
      );
      processed += 1;
    }

    return processed;
  }

  /** Index upline team rows for NFTMarketplace `Purchased` (replaces legacy SaleLevelDistribute). */
  async indexNftSaleLevelIncomeFromTx(
    txHash: `0x${string}`,
    tradeDate: Date,
    ctx?: { tokenId?: string; sellerWallet?: string; buyer?: string; priceWei?: bigint; logIndex?: number; blockNumber?: bigint }
  ): Promise<number> {
    void ctx;
    void tradeDate;
    const ev = await this.prisma.chainEvent.findFirst({
      where: { chainId: env.CHAIN_ID, txHash, eventName: "Purchased" },
      orderBy: { logIndex: "asc" }
    });
    if (!ev) return 0;
    const p = ev.payload as Record<string, unknown>;
    const buyer = (ctx?.buyer ?? p.buyer) as `0x${string}` | undefined;
    const priceRaw = ctx?.priceWei ?? (p.price != null ? BigInt(String(p.price)) : undefined);
    if (!buyer || priceRaw == null) return 0;
    const bn =
      ctx?.blockNumber ??
      (typeof ev.blockNumber === "bigint" ? ev.blockNumber : BigInt(String(ev.blockNumber)));
    const result = await indexMarketplacePurchasedIncome(this.prisma, {
      buyer,
      tokenId: ctx?.tokenId ?? String(p.tokenId),
      priceWei: priceRaw,
      txHash,
      logIndex: ctx?.logIndex ?? ev.logIndex,
      blockNumber: bn,
      tradeDate
    });
    return result.levelRows;
  }

  async backfillNftSaleLevelIncomeForUser(userId: string, limit = 400): Promise<{ inserted: number }> {
    const r = await backfillMarketplacePurchasedIncomeForUser(this.prisma, userId, limit);
    return { inserted: r.inserted };
  }

  async backfillNftSaleLevelIncomeFromChain(): Promise<{ inserted: number; scanned: number }> {
    return backfillMarketplacePurchasedIncomeForUser(this.prisma, "all", 1200);
  }

  async backfillMissingNftOwnershipHistoryFromChainEvents(
    _limit = 400
  ): Promise<{ scanned: number; inserted: number }> {
    return { scanned: 0, inserted: 0 };
  }

  private async ensureTradingLogFromChainEventIfMissing(
    ev: {
      chainId: number;
      blockNumber: bigint;
      txHash: string;
      contract: string;
      eventName: string;
      payload: Prisma.JsonValue;
    },
    resolveTradeDate?: (blockNumber: bigint) => Promise<Date>
  ): Promise<void> {
    if (ev.eventName !== "Purchased") return;
    if (ev.chainId !== env.CHAIN_ID) return;

    const p = ev.payload as Record<string, unknown>;
    const addrRaw = p.buyer;
    if (typeof addrRaw !== "string") return;
    const wallet = normalizeAddr(addrRaw);
    const weiRaw = p.price;
    if (weiRaw === undefined || weiRaw === null) return;
    let wei: bigint;
    try {
      wei = BigInt(String(weiRaw));
    } catch {
      return;
    }
    if (wei === 0n) return;

    const wc = await this.prisma.walletConnection.findFirst({
      where: { walletAddress: wallet },
      include: { user: { select: { createdAt: true } } }
    });
    if (!wc) return;
    const periodAnchor = wc.user.createdAt;

    const rawTid = p.tokenId;
    const relatedTokenId =
      rawTid === undefined || rawTid === null ? null : String(rawTid).trim() || null;
    if (!relatedTokenId) return;

    const already = await tradingLogExistsForChainPurchase(
      this.prisma,
      wc.userId,
      ev.txHash,
      relatedTokenId
    );
    if (already) return;

    const activation = await this.prisma.packageActivation.findFirst({
      where: { userId: wc.userId, isCurrent: true },
      include: { tier: true }
    });
    if (!activation) return;

    const tradeDate = resolveTradeDate
      ? await resolveTradeDate(ev.blockNumber)
      : await (async () => {
          const client = getPublicClient();
          const block = await client.getBlock({ blockNumber: ev.blockNumber });
          return new Date(Number(block.timestamp) * 1000);
        })();

    if (activation.tradingVolumeSince && tradeDate < activation.tradingVolumeSince) {
      return;
    }

    const divisor = await getDailyVolumeDivisor(this.prisma);
    const allowedDailyVolume = Number(activation.tier.tradingLimit) / divisor;
    const volume = new Prisma.Decimal(formatEther(wei));

    await createTradingLogIdempotent(this.prisma, {
      userId: wc.userId,
      packageActivationId: activation.id,
      tradeDate,
      volume,
      allowedDailyVolume: new Prisma.Decimal(allowedDailyVolume),
      chainTxHash: normalizeTxHash(ev.txHash),
      relatedTokenId
    });

    const now = new Date();
    if (!isTradeDateInCurrentPeriod(tradeDate, now, periodAnchor)) {
      try {
        await syncUserPackageIncomeMetrics(this.prisma, wc.userId);
      } catch {
        /* best-effort */
      }
      return;
    }

    const { periodStart } = getTradingPeriodBounds(tradeDate, periodAnchor);
    const globalDailySince = await getGlobalDailyVolumeSince(this.prisma);
    const volSum = await this.prisma.tradingLog.aggregate({
      where: userDayTradingLogWhere(
        wc.userId,
        activation.tradingVolumeSince,
        now,
        globalDailySince,
        periodAnchor
      ),
      _sum: { volume: true }
    });
    const achievedForDay = Number(volSum._sum.volume ?? 0);
    const compliance = new TradingComplianceService(this.prisma);
    await compliance.evaluateDay(
      wc.userId,
      periodStart,
      allowedDailyVolume,
      achievedForDay,
      periodAnchor
    );
    try {
      await syncUserPackageIncomeMetrics(this.prisma, wc.userId);
    } catch {
      /* best-effort */
    }
  }

  private async repairTradingLogChainTxFromIndexedEvent(ev: {
    eventName: string;
    txHash: string;
    payload: Prisma.JsonValue;
    processedAt: Date;
    chainId: number;
    blockNumber: bigint;
    logIndex: number;
    contract: string;
  }): Promise<void> {
    try {
      if (ev.eventName !== "Purchased") return;
      const p = ev.payload as Record<string, unknown>;
      const addrRaw = p.buyer;
      if (typeof addrRaw !== "string") return;
      const wallet = normalizeAddr(addrRaw);
      const weiRaw = p.price;
      if (weiRaw === undefined || weiRaw === null) return;
      let wei: bigint;
      try {
        wei = BigInt(String(weiRaw));
      } catch {
        return;
      }
      if (wei === 0n) return;

      const wc = await this.prisma.walletConnection.findFirst({
        where: { walletAddress: wallet }
      });
      if (!wc) return;

      const t0 = new Date(ev.processedAt.getTime() - 90 * 60 * 1000);
      const t1 = new Date(ev.processedAt.getTime() + 90 * 60 * 1000);

      const candidates = await this.prisma.tradingLog.findMany({
        where: {
          userId: wc.userId,
          chainTxHash: null,
          createdAt: { gte: t0, lte: t1 }
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, volume: true }
      });
      const volWei = Number(formatEther(wei));
      const candidate = candidates.find((c) => {
        const v = Number(c.volume);
        return Number.isFinite(v) && Number.isFinite(volWei) && Math.abs(v - volWei) <= 0.06;
      });
      if (candidate) {
        const rawTid = p.tokenId;
        const relatedTokenId =
          rawTid === undefined || rawTid === null ? undefined : String(rawTid).trim() || undefined;
        await this.prisma.tradingLog.update({
          where: { id: candidate.id },
          data: {
            chainTxHash: ev.txHash,
            ...(relatedTokenId ? { relatedTokenId } : {})
          }
        });
        return;
      }

      await this.ensureTradingLogFromChainEventIfMissing({
        chainId: ev.chainId,
        blockNumber: ev.blockNumber,
        txHash: ev.txHash,
        contract: ev.contract,
        eventName: ev.eventName,
        payload: ev.payload
      });
    } catch (e) {
      logger.warn(e, "chain-indexer: repairTradingLogChainTxFromIndexedEvent");
    }
  }

  async backfillTradingLogsFromChainEventsForUser(userId: string): Promise<void> {
    const wallets = await this.prisma.walletConnection.findMany({
      where: { userId },
      select: { walletAddress: true }
    });
    const walletSet = new Set(wallets.map((w) => normalizeAddr(w.walletAddress)));
    if (walletSet.size === 0) return;

    const addrs = [...walletSet];
    type Row = {
      chainId: number;
      blockNumber: bigint;
      txHash: string;
      contract: string;
      eventName: string;
      payload: Prisma.JsonValue;
    };
    const mine = await this.prisma.$queryRaw<Row[]>`
      SELECT "chainId", "blockNumber", "txHash", contract, "eventName", payload
      FROM "ChainEvent"
      WHERE "chainId" = ${env.CHAIN_ID}
        AND "eventName" = 'Purchased'
        AND LOWER(payload->>'buyer') IN (${Prisma.join(addrs)})
      ORDER BY "processedAt" DESC
      LIMIT 200
    `;

    const blockTimeCache = new Map<string, Date>();
    const getTradeDate = async (blockNumber: bigint): Promise<Date> => {
      const key = blockNumber.toString();
      const hit = blockTimeCache.get(key);
      if (hit) return hit;
      const client = getPublicClient();
      const block = await client.getBlock({ blockNumber });
      const d = new Date(Number(block.timestamp) * 1000);
      blockTimeCache.set(key, d);
      return d;
    };

    for (const ev of mine) {
      try {
        const blockNumber =
          typeof ev.blockNumber === "bigint" ? ev.blockNumber : BigInt(String(ev.blockNumber));
        await this.ensureTradingLogFromChainEventIfMissing(
          {
            chainId: ev.chainId,
            blockNumber,
            txHash: ev.txHash,
            contract: ev.contract,
            eventName: ev.eventName,
            payload: ev.payload
          },
          getTradeDate
        );
      } catch (e) {
        logger.warn(e, "chain-indexer: backfillTradingLogsFromChainEventsForUser");
      }
    }
  }

  private async persistChainEventOnly(
    contract: string,
    eventName: string,
    log: { blockNumber: bigint; logIndex: number; transactionHash: string },
    args: Record<string, unknown>
  ): Promise<void> {
    await insertChainEventSkipDup(this.prisma, {
      chainId: env.CHAIN_ID,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      contract,
      eventName,
      payload: jsonPayload(args)
    });
  }

  private async persistListed(
    args: { tokenId: bigint; price: bigint },
    log: { address: string; blockNumber: bigint; logIndex: number; transactionHash: string }
  ): Promise<void> {
    const priceDec = new Prisma.Decimal(formatEther(args.price));
    const tokenIdStr = String(args.tokenId);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.nFTRecord.findUnique({ where: { tokenId: tokenIdStr } });
      if (existing) {
        await tx.nFTRecord.update({
          where: { tokenId: tokenIdStr },
          data: { currentValue: priceDec }
        });
      }
      await insertChainEventSkipDup(tx, {
        chainId: env.CHAIN_ID,
        blockNumber: log.blockNumber,
        logIndex: Number(log.logIndex),
        txHash: log.transactionHash,
        contract: log.address,
        eventName: "Listed",
        payload: jsonPayload({
          tokenId: tokenIdStr,
          price: args.price.toString()
        })
      });
    });
  }

  private async persistPurchased(
    args: { buyer: `0x${string}`; tokenId: bigint; price: bigint },
    tradeDate: Date,
    txHash: string,
    log: { address: string; blockNumber: bigint; logIndex: number; transactionHash: string }
  ): Promise<void> {
    const wallet = normalizeAddr(args.buyer);
    const wc = await this.prisma.walletConnection.findFirst({
      where: { walletAddress: wallet },
      include: { user: { select: { createdAt: true } } }
    });

    const priceDec = new Prisma.Decimal(formatEther(args.price));

    if (!wc) {
      logger.warn({ wallet, txHash }, "chain-indexer: no wallet for Purchased");
      await this.persistChainEventOnly(log.address, "Purchased", log, {
        buyer: args.buyer,
        tokenId: args.tokenId.toString(),
        price: args.price.toString()
      });
      void indexMarketplacePurchasedIncome(this.prisma, {
        buyer: args.buyer,
        tokenId: String(args.tokenId),
        priceWei: args.price,
        txHash: log.transactionHash,
        logIndex: Number(log.logIndex),
        blockNumber: log.blockNumber,
        tradeDate
      }).catch((e) => logger.warn(e, "chain-indexer: marketplace purchased income index failed"));
      return;
    }

    const activation = await this.prisma.packageActivation.findFirst({
      where: { userId: wc.userId, isCurrent: true },
      include: { tier: true }
    });

    if (!activation) {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.nFTRecord.upsert({
          where: { tokenId: String(args.tokenId) },
          create: {
            userId: wc.userId,
            tokenId: String(args.tokenId),
            baseValue: priceDec,
            currentValue: priceDec
          },
          update: {
            userId: wc.userId,
            currentValue: priceDec
          }
        });

        await insertChainEventSkipDup(tx, {
          chainId: env.CHAIN_ID,
          blockNumber: log.blockNumber,
          logIndex: Number(log.logIndex),
          txHash: log.transactionHash,
          contract: log.address,
          eventName: "Purchased",
          payload: jsonPayload({
            buyer: args.buyer,
            tokenId: args.tokenId.toString(),
            price: args.price.toString()
          })
        });
      });
      try {
        await syncUserPackageIncomeMetrics(this.prisma, wc.userId);
      } catch {
        /* best-effort */
      }
      void indexMarketplacePurchasedIncome(this.prisma, {
        buyer: args.buyer,
        tokenId: String(args.tokenId),
        priceWei: args.price,
        txHash: log.transactionHash,
        logIndex: Number(log.logIndex),
        blockNumber: log.blockNumber,
        tradeDate
      }).catch((e) => logger.warn(e, "chain-indexer: marketplace purchased income index failed"));
      return;
    }

    const divisor = await getDailyVolumeDivisor(this.prisma);
    const allowedDailyVolume = Number(activation.tier.tradingLimit) / divisor;
    const volume = new Prisma.Decimal(formatEther(args.price));

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.nFTRecord.upsert({
        where: { tokenId: String(args.tokenId) },
        create: {
          userId: wc.userId,
          tokenId: String(args.tokenId),
          baseValue: priceDec,
          currentValue: priceDec
        },
        update: {
          userId: wc.userId,
          currentValue: priceDec
        }
      });

      const tokenIdStr = String(args.tokenId);
      const txNorm = normalizeTxHash(log.transactionHash);
      const skipTradingVolume =
        Boolean(activation.tradingVolumeSince && tradeDate < activation.tradingVolumeSince);
      if (
        !skipTradingVolume &&
        (await createTradingLogIdempotent(tx, {
          userId: wc.userId,
          packageActivationId: activation.id,
          tradeDate,
          volume,
          allowedDailyVolume: new Prisma.Decimal(allowedDailyVolume),
          chainTxHash: txNorm,
          relatedTokenId: tokenIdStr
        }))
      ) {
        /* created */
      }

      await insertChainEventSkipDup(tx, {
        chainId: env.CHAIN_ID,
        blockNumber: log.blockNumber,
        logIndex: Number(log.logIndex),
        txHash: log.transactionHash,
        contract: log.address,
        eventName: "Purchased",
        payload: jsonPayload({
          buyer: args.buyer,
          tokenId: args.tokenId.toString(),
          price: args.price.toString()
        })
      });
    });

    const periodAnchor = wc.user.createdAt;
    const now = new Date();
    if (isTradeDateInCurrentPeriod(tradeDate, now, periodAnchor)) {
      const { periodStart } = getTradingPeriodBounds(tradeDate, periodAnchor);
      const globalDailySince = await getGlobalDailyVolumeSince(this.prisma);
      const volSum = await this.prisma.tradingLog.aggregate({
        where: userDayTradingLogWhere(
          wc.userId,
          activation.tradingVolumeSince,
          now,
          globalDailySince,
          periodAnchor
        ),
        _sum: { volume: true }
      });
      const achievedForDay = Number(volSum._sum.volume ?? 0);
      const compliance = new TradingComplianceService(this.prisma);
      await compliance.evaluateDay(
        wc.userId,
        periodStart,
        allowedDailyVolume,
        achievedForDay,
        periodAnchor
      );
    }
    try {
      await syncUserPackageIncomeMetrics(this.prisma, wc.userId);
    } catch {
      /* best-effort */
    }

    void indexMarketplacePurchasedIncome(this.prisma, {
      buyer: args.buyer,
      tokenId: String(args.tokenId),
      priceWei: args.price,
      txHash: log.transactionHash,
      logIndex: Number(log.logIndex),
      blockNumber: log.blockNumber,
      tradeDate
    }).catch((e) => logger.warn(e, "chain-indexer: marketplace purchased income index failed"));
  }

  private async persistActivated(
    args: {
      user: `0x${string}`;
      packageId: number;
      price: bigint;
      tradingLimit: bigint;
    },
    txHash: string,
    log: { address: string; blockNumber: bigint; logIndex: number; transactionHash: string },
    blockTime: Date
  ): Promise<void> {
    const wallet = normalizeAddr(args.user);
    const wc = await this.prisma.walletConnection.findFirst({
      where: { walletAddress: wallet }
    });
    if (!wc) {
      logger.warn({ wallet, txHash }, "chain-indexer: no wallet for Activated");
      await this.persistChainEventOnly(log.address, "Activated", log, {
        user: args.user,
        packageId: args.packageId,
        price: args.price.toString(),
        tradingLimit: args.tradingLimit.toString()
      });
      return;
    }

    const usd = PACKAGE_USD_BY_ID[args.packageId];
    if (usd == null) {
      logger.warn({ packageId: args.packageId, txHash }, "chain-indexer: unknown packageId");
      await this.persistChainEventOnly(log.address, "Activated", log, {
        user: args.user,
        packageId: args.packageId,
        price: args.price.toString(),
        tradingLimit: args.tradingLimit.toString()
      });
      return;
    }

    const tier = await this.prisma.packageTier.findFirst({
      where: { activationAmount: new Prisma.Decimal(usd), isActive: true },
      orderBy: { sortOrder: "asc" }
    });
    if (!tier) {
      logger.warn({ usd, txHash }, "chain-indexer: no PackageTier for Activated package");
      await this.persistChainEventOnly(log.address, "Activated", log, {
        user: args.user,
        packageId: args.packageId,
        price: args.price.toString(),
        tradingLimit: args.tradingLimit.toString()
      });
      return;
    }

    const userId = wc.userId;
    const dupAct = await this.prisma.packageActivation.findFirst({
      where: { chainTxHash: txHash, onChain: true },
      include: { tier: true }
    });

    if (dupAct) {
      await this.persistChainEventOnly(log.address, "Activated", log, {
        user: args.user,
        packageId: args.packageId,
        price: args.price.toString(),
        tradingLimit: args.tradingLimit.toString()
      });
      const hasDist = await this.prisma.tokenDistributionLog.findFirst({
        where: { activationId: dupAct.id },
        select: { id: true }
      });
      if (!hasDist) {
        try {
          const sponsorRow = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { sponsorId: true }
          });
          const effectiveSponsor = effectiveActivationSponsorId(sponsorRow?.sponsorId, undefined);
          const rewards = new RewardEngineService(this.prisma);
          await rewards.processActivationDistribution(
            userId,
            dupAct.id,
            Number(dupAct.tier.activationAmount),
            effectiveSponsor,
            { complianceAsOf: blockTime, incomeCapAsOf: blockTime }
          );
        } catch (e) {
          logger.error(e, "chain-indexer: repair processActivationDistribution for duplicate Activated tx");
        }
      }
      return;
    }

    const activationId = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.packageActivation.updateMany({
        where: { userId, isCurrent: true },
        data: { isCurrent: false }
      });
      const created = await tx.packageActivation.create({
        data: {
          userId,
          tierId: tier.id,
          isCurrent: true,
          chainTxHash: txHash,
          onChain: true,
          activatedAt: blockTime
        },
        select: { id: true }
      });

      await insertChainEventSkipDup(tx, {
        chainId: env.CHAIN_ID,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
        contract: log.address,
        eventName: "Activated",
        payload: jsonPayload({
          user: args.user,
          packageId: args.packageId,
          price: args.price.toString(),
          tradingLimit: args.tradingLimit.toString()
        })
      });
      return created.id;
    });

    try {
      const sponsorRow = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { sponsorId: true }
      });
      const effectiveSponsor = effectiveActivationSponsorId(sponsorRow?.sponsorId, undefined);
      const rewards = new RewardEngineService(this.prisma);
      await rewards.processActivationDistribution(userId, activationId, usd, effectiveSponsor, {
        complianceAsOf: blockTime,
        incomeCapAsOf: blockTime
      });
    } catch (e) {
      logger.error(e, "chain-indexer: processActivationDistribution after Activated failed");
    }
  }

  private async persistUpgraded(
    args: {
      user: `0x${string}`;
      oldPackageId: number;
      newPackageId: number;
      price: bigint;
      tradingLimit: bigint;
    },
    txHash: string,
    log: { address: string; blockNumber: bigint; logIndex: number; transactionHash: string },
    blockTime: Date
  ): Promise<void> {
    const wallet = normalizeAddr(args.user);
    const wc = await this.prisma.walletConnection.findFirst({
      where: { walletAddress: wallet }
    });
    const payload = {
      user: args.user,
      oldPackageId: args.oldPackageId,
      newPackageId: args.newPackageId,
      price: args.price.toString(),
      tradingLimit: args.tradingLimit.toString()
    };

    if (!wc) {
      await this.persistChainEventOnly(log.address, "Upgraded", log, payload);
      return;
    }

    const usd = PACKAGE_USD_BY_ID[args.newPackageId];
    if (usd == null) {
      await this.persistChainEventOnly(log.address, "Upgraded", log, payload);
      return;
    }

    const tier = await this.prisma.packageTier.findFirst({
      where: { activationAmount: new Prisma.Decimal(usd), isActive: true },
      orderBy: { sortOrder: "asc" }
    });
    if (!tier) {
      await this.persistChainEventOnly(log.address, "Upgraded", log, payload);
      return;
    }

    const userId = wc.userId;
    const dupAct = await this.prisma.packageActivation.findFirst({
      where: { chainTxHash: txHash, onChain: true },
      select: { id: true }
    });
    if (dupAct) {
      await this.persistChainEventOnly(log.address, "Upgraded", log, payload);
      return;
    }

    const activationId = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.packageActivation.updateMany({
        where: { userId, isCurrent: true },
        data: { isCurrent: false }
      });
      const created = await tx.packageActivation.create({
        data: {
          userId,
          tierId: tier.id,
          isCurrent: true,
          chainTxHash: txHash,
          onChain: true,
          activatedAt: blockTime
        },
        select: { id: true }
      });
      await insertChainEventSkipDup(tx, {
        chainId: env.CHAIN_ID,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
        contract: log.address,
        eventName: "Upgraded",
        payload: jsonPayload(payload)
      });
      return created.id;
    });

    try {
      const sponsorRow = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { sponsorId: true }
      });
      const effectiveSponsor = effectiveActivationSponsorId(sponsorRow?.sponsorId, undefined);
      const rewards = new RewardEngineService(this.prisma);
      await rewards.processActivationDistribution(userId, activationId, usd, effectiveSponsor, {
        complianceAsOf: blockTime,
        incomeCapAsOf: blockTime
      });
    } catch (e) {
      logger.error(e, "chain-indexer: processActivationDistribution after Upgraded failed");
    }
  }

  async findActivationByTx(txHash: string) {
    const act = await this.prisma.packageActivation.findFirst({
      where: { chainTxHash: txHash, onChain: true },
      include: { tier: true, user: { select: { id: true, publicUserNumber: true } } }
    });
    const events = await this.prisma.chainEvent.findMany({
      where: { txHash },
      orderBy: { logIndex: "asc" }
    });
    return { activation: act, events };
  }
}
