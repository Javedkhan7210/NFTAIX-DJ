/**
 * Index NFTMarketplace `Purchased` resale economics into app income tables:
 * - Seller profit share → `NftSaleTradingIncome` + `IncomeLedger` (`nft`)
 * - Buyer upline team slice → `NftSaleLevelIncome` (NFT level income on dashboard)
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { formatEther, parseUnits, type Address, zeroAddress } from "viem";
import { env } from "../../shared/config/env.js";
import { RewardEngineService } from "../rewards/reward-engine.service.js";
import { userIdForWallet } from "../rewards/on-chain-sponsor.js";
import { marketplaceAbi } from "./marketplace-abi.js";
import { registrationAbi } from "./registration-abi.js";
import { getPublicClient } from "./chain-viem.js";

const BPS = 10_000n;
const MAX_LEVELS = 20;

function normalizeAddr(a: string): string {
  return a.trim().toLowerCase();
}

function normalizeTxHash(h: string): string {
  return h.trim().toLowerCase();
}

export type MarketplacePurchasedIncomeParams = {
  buyer: Address;
  tokenId: string;
  priceWei: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  tradeDate: Date;
};

async function getProfitSharePct(prisma: PrismaClient): Promise<number> {
  const row = await prisma.rewardSetting.findUnique({ where: { key: "nft.tradingIncomeProfitSharePct" } });
  if (!row) return 30;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.floor(n) : 30;
}

async function readMarketplaceEconomics(mp: Address) {
  const client = getPublicClient();
  const [appreciationBps, sellerBps, teamBps] = await Promise.all([
    client.readContract({ address: mp, abi: marketplaceAbi, functionName: "appreciationBps" }),
    client.readContract({ address: mp, abi: marketplaceAbi, functionName: "sellerBps" }),
    client.readContract({ address: mp, abi: marketplaceAbi, functionName: "teamBps" })
  ]);
  return { appreciationBps: BigInt(appreciationBps), sellerBps: BigInt(sellerBps), teamBps: BigInt(teamBps) };
}

async function sellerBeforePurchase(
  mp: Address,
  tokenId: bigint,
  blockNumber: bigint
): Promise<Address | null> {
  if (blockNumber === 0n) return null;
  const client = getPublicClient();
  try {
    const seller = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "sellerOf",
      args: [tokenId],
      blockNumber: blockNumber - 1n
    });
    if (!seller || seller === zeroAddress) return null;
    return seller as Address;
  } catch {
    return null;
  }
}

type TeamPayout = { level: number; wallet: Address; amountWei: bigint };

async function computeTeamPayouts(
  registration: Address,
  buyer: Address,
  profitWei: bigint,
  teamBps: bigint
): Promise<TeamPayout[]> {
  if (profitWei <= 0n || teamBps <= 0n) return [];
  const teamBudget = (profitWei * teamBps) / BPS;
  if (teamBudget <= 0n) return [];
  const perLevel = teamBudget / BigInt(MAX_LEVELS);
  if (perLevel <= 0n) return [];

  const client = getPublicClient();
  const out: TeamPayout[] = [];
  let current = (
    await client.readContract({
      address: registration,
      abi: registrationAbi,
      functionName: "users",
      args: [buyer]
    })
  )[3] as Address;

  for (let level = 1; level <= MAX_LEVELS; level++) {
    if (!current || current === zeroAddress) break;
    const row = await client.readContract({
      address: registration,
      abi: registrationAbi,
      functionName: "users",
      args: [current]
    });
    const registered = row[0];
    const permanentlyInactive = row[2];
    const nextSponsor = row[3] as Address;
    const directCount = row[8];

    if (registered && !permanentlyInactive) {
      const unlocked = await client.readContract({
        address: registration,
        abi: registrationAbi,
        functionName: "nftLevelsForDirects",
        args: [directCount]
      });
      if (BigInt(unlocked) >= BigInt(level)) {
        out.push({ level, wallet: current, amountWei: perLevel });
      }
    }
    current = nextSponsor;
  }
  return out;
}

async function recordTradingIncome(
  prisma: PrismaClient,
  params: {
    txHash: string;
    logIndex: number;
    tokenId: string;
    salePriceWei: bigint;
    purchaseBasisDecimal: Prisma.Decimal | null;
    appreciationBps: bigint;
    profitSharePct: number;
    sellerUserId: string;
    buyerUserId?: string;
    sourceUserId?: string;
    tradeDate: Date;
  }
): Promise<boolean> {
  const saleWei = params.salePriceWei;
  if (saleWei <= 0n) return false;

  let purchaseWei: bigint;
  try {
    if (params.purchaseBasisDecimal && !params.purchaseBasisDecimal.isZero()) {
      purchaseWei = parseUnits(params.purchaseBasisDecimal.toString(), 18);
    } else {
      purchaseWei = (saleWei * BPS) / (BPS + params.appreciationBps);
    }
  } catch {
    return false;
  }
  if (purchaseWei >= saleWei) return false;

  const profitWei = saleWei - purchaseWei;
  if (profitWei <= 0n) return false;

  const pct = BigInt(Math.min(100, Math.max(0, Math.floor(params.profitSharePct))));
  const tradingWei = (profitWei * pct) / 100n;
  if (tradingWei <= 0n) return false;

  const inserted = await prisma.nftSaleTradingIncome.createMany({
    data: [
      {
        chainId: env.CHAIN_ID,
        txHash: normalizeTxHash(params.txHash),
        logIndex: params.logIndex,
        tokenId: params.tokenId,
        sellerUserId: params.sellerUserId,
        buyerUserId: params.buyerUserId,
        purchasePriceUsdt: new Prisma.Decimal(formatEther(purchaseWei)),
        salePriceUsdt: new Prisma.Decimal(formatEther(saleWei)),
        profitUsdt: new Prisma.Decimal(formatEther(profitWei)),
        tradingIncomeUsdt: new Prisma.Decimal(formatEther(tradingWei)),
        profitSharePct: Number(pct),
        profitCalculated: true,
        createdAt: params.tradeDate
      }
    ],
    skipDuplicates: true
  });
  if (inserted.count === 0) return false;

  const rewards = new RewardEngineService(prisma);
  await prisma.$transaction(async (tx) => {
    await rewards.grantNftTradingIncomeInTx(tx, {
      recipientUserId: params.sellerUserId,
      sourceUserId: params.sourceUserId,
      sellerExtraUsdt: Number(formatEther(tradingWei)),
      incomeCapAsOf: params.tradeDate
    });
  });
  return true;
}

async function recordLevelIncome(
  prisma: PrismaClient,
  params: {
    txHash: string;
    baseLogIndex: number;
    tokenId: string;
    treeLine: number;
    rewardWei: bigint;
    recipientWallet: Address;
    sellerWallet: string | null;
    tradeDate: Date;
  }
): Promise<number> {
  if (params.rewardWei <= 0n) return 0;
  const recipientUserId = await userIdForWallet(prisma, params.recipientWallet);
  const syntheticLogIndex = params.baseLogIndex * 100 + params.treeLine;
  const result = await prisma.nftSaleLevelIncome.createMany({
    data: [
      {
        chainId: env.CHAIN_ID,
        txHash: normalizeTxHash(params.txHash),
        logIndex: syntheticLogIndex,
        tokenId: params.tokenId,
        treeLine: params.treeLine,
        amountUsdt: new Prisma.Decimal(formatEther(params.rewardWei)),
        recipientWallet: normalizeAddr(params.recipientWallet),
        recipientUserId: recipientUserId ?? undefined,
        sellerWallet: params.sellerWallet ?? undefined,
        createdAt: params.tradeDate
      }
    ],
    skipDuplicates: true
  });
  return result.count;
}

export async function indexMarketplacePurchasedIncome(
  prisma: PrismaClient,
  params: MarketplacePurchasedIncomeParams
): Promise<{ tradingRecorded: boolean; levelRows: number }> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as Address | undefined;
  if (!mp || params.priceWei <= 0n) return { tradingRecorded: false, levelRows: 0 };

  const client = getPublicClient();
  const registration = (await client.readContract({
    address: mp,
    abi: marketplaceAbi,
    functionName: "registration"
  })) as Address;

  const tokenIdBn = BigInt(params.tokenId);
  const econ = await readMarketplaceEconomics(mp);
  const profitSharePct = await getProfitSharePct(prisma);
  const costBasisWei = (params.priceWei * BPS) / (BPS + econ.appreciationBps);
  const profitWei = params.priceWei > costBasisWei ? params.priceWei - costBasisWei : 0n;

  const sellerWallet = await sellerBeforePurchase(mp, tokenIdBn, params.blockNumber);
  const sellerWalletNorm = sellerWallet ? normalizeAddr(sellerWallet) : null;

  let tradingRecorded = false;
  if (sellerWallet) {
    const sellerUserId = await userIdForWallet(prisma, sellerWallet);
    if (sellerUserId) {
      const priorNft = await prisma.nFTRecord.findUnique({
        where: { tokenId: params.tokenId },
        select: { userId: true, currentValue: true, baseValue: true }
      });
      const purchaseBasisDecimal =
        priorNft && priorNft.userId === sellerUserId
          ? priorNft.currentValue ?? priorNft.baseValue
          : null;
      const buyerUserId = await userIdForWallet(prisma, params.buyer);
      tradingRecorded = await recordTradingIncome(prisma, {
        txHash: params.txHash,
        logIndex: params.logIndex,
        tokenId: params.tokenId,
        salePriceWei: params.priceWei,
        purchaseBasisDecimal,
        appreciationBps: econ.appreciationBps,
        profitSharePct,
        sellerUserId,
        buyerUserId,
        sourceUserId: buyerUserId,
        tradeDate: params.tradeDate
      });
    }
  }

  const teamPayouts = await computeTeamPayouts(registration, params.buyer, profitWei, econ.teamBps);
  let levelRows = 0;
  for (const row of teamPayouts) {
    levelRows += await recordLevelIncome(prisma, {
      txHash: params.txHash,
      baseLogIndex: params.logIndex,
      tokenId: params.tokenId,
      treeLine: row.level,
      rewardWei: row.amountWei,
      recipientWallet: row.wallet,
      sellerWallet: sellerWalletNorm,
      tradeDate: params.tradeDate
    });
  }

  return { tradingRecorded, levelRows };
}

export async function backfillMarketplacePurchasedIncomeForUser(
  prisma: PrismaClient,
  _userId: string,
  limit = 400
): Promise<{ inserted: number; scanned: number }> {
  const events = await prisma.chainEvent.findMany({
    where: { chainId: env.CHAIN_ID, eventName: "Purchased" },
    orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
    take: Math.min(Math.max(limit, 50), 800)
  });

  const client = getPublicClient();
  const blockTs = new Map<string, Date>();
  let inserted = 0;

  for (const ev of events) {
    const p = ev.payload as Record<string, unknown>;
    const buyerRaw = p.buyer;
    const tokenRaw = p.tokenId;
    const priceRaw = p.price;
    if (typeof buyerRaw !== "string" || tokenRaw == null || priceRaw == null) continue;

    let priceWei: bigint;
    try {
      priceWei = BigInt(String(priceRaw));
    } catch {
      continue;
    }

    const bn = typeof ev.blockNumber === "bigint" ? ev.blockNumber : BigInt(String(ev.blockNumber));
    let tradeDate = blockTs.get(bn.toString());
    if (!tradeDate) {
      const block = await client.getBlock({ blockNumber: bn });
      tradeDate = new Date(Number(block.timestamp) * 1000);
      blockTs.set(bn.toString(), tradeDate);
    }

    const result = await indexMarketplacePurchasedIncome(prisma, {
      buyer: buyerRaw as Address,
      tokenId: String(tokenRaw),
      priceWei,
      txHash: ev.txHash,
      logIndex: ev.logIndex,
      blockNumber: bn,
      tradeDate
    });

    inserted += (result.tradingRecorded ? 1 : 0) + result.levelRows;
  }

  return { inserted, scanned: events.length };
}
