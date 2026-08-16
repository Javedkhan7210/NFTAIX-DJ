import { GlobalRank, PrismaClient } from "@prisma/client";
import {
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type PublicClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { appChain, getPublicClient } from "../chain/chain-viem.js";
import { globalPoolAbi } from "../chain/global-pool-abi.js";
import { env } from "../../shared/config/env.js";

function normalizePk(pk: string): `0x${string}` {
  const t = pk.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as `0x${string}`;
}

export function globalPoolPayoutEnabled(): boolean {
  if (!env.GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED) return false;
  if (!env.USDT_CONTRACT_ADDRESS?.trim()) return false;
  if (!env.GLOBAL_POOL_CONTRACT_ADDRESS?.trim()) return false;
  if (!globalPoolPayoutPrivateKey()) return false;
  return true;
}

/** GlobalPool owner key — pays via distributeDay, not admin USDT wallet. */
export function globalPoolPayoutPrivateKey(): string | undefined {
  return (
    env.GLOBAL_POOL_PAYOUT_PRIVATE_KEY?.trim() ||
    env.CONTRACT_ADMIN_PRIVATE_KEY?.trim() ||
    env.CHAIN_PRIVATE_KEY?.trim() ||
    undefined
  );
}

function payoutFromGlobalPoolContract(): boolean {
  return env.GLOBAL_POOL_PAYOUT_SOURCE !== "wallet";
}

async function readUsdtDecimals(client: PublicClient, usdt: Address): Promise<number> {
  try {
    const d = await client.readContract({ address: usdt, abi: erc20Abi, functionName: "decimals" });
    return Number(d);
  } catch {
    return env.USDT_DECIMALS;
  }
}

/** On-chain GlobalPool balances (day pool + contract USDT). */
export async function readOnChainGlobalFundUsdt(): Promise<{
  registrationReserveUsdt: number | null;
  marketplaceReserveUsdt: number | null;
  registrationContractBalanceUsdt: number | null;
  globalPoolDayPoolUsdt: number | null;
  globalPoolBalanceUsdt: number | null;
  totalOnChainUsdt: number;
}> {
  const client = getPublicClient();
  const usdt = env.USDT_CONTRACT_ADDRESS as Address | undefined;
  const pool = env.GLOBAL_POOL_CONTRACT_ADDRESS as Address | undefined;
  if (!usdt || !pool) {
    return {
      registrationReserveUsdt: null,
      marketplaceReserveUsdt: null,
      registrationContractBalanceUsdt: null,
      globalPoolDayPoolUsdt: null,
      globalPoolBalanceUsdt: null,
      totalOnChainUsdt: 0
    };
  }

  const decimals = await readUsdtDecimals(client, usdt);
  const toUsdt = (wei: bigint) => Number(formatUnits(wei, decimals));

  let globalPoolDayPoolUsdt: number | null = null;
  let globalPoolBalanceUsdt: number | null = null;

  try {
    const day = await client.readContract({
      address: pool,
      abi: globalPoolAbi,
      functionName: "currentDay"
    });
    const dayWei = await client.readContract({
      address: pool,
      abi: globalPoolAbi,
      functionName: "dayPool",
      args: [day]
    });
    globalPoolDayPoolUsdt = toUsdt(dayWei);
  } catch {
    globalPoolDayPoolUsdt = null;
  }

  try {
    const bal = await client.readContract({
      address: usdt,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [pool]
    });
    globalPoolBalanceUsdt = toUsdt(bal);
  } catch {
    globalPoolBalanceUsdt = null;
  }

  const totalOnChainUsdt = globalPoolDayPoolUsdt ?? globalPoolBalanceUsdt ?? 0;

  return {
    registrationReserveUsdt: null,
    marketplaceReserveUsdt: null,
    registrationContractBalanceUsdt: null,
    globalPoolDayPoolUsdt,
    globalPoolBalanceUsdt,
    totalOnChainUsdt
  };
}

/**
 * Pool size from GlobalPool dayPool / USDT balance only.
 */
export async function resolveGlobalPoolTotalUsdt(
  _prisma: PrismaClient
): Promise<{ totalPool: number; funding: Record<string, unknown> }> {
  const onChain = await readOnChainGlobalFundUsdt();
  const total =
    onChain.globalPoolDayPoolUsdt != null && onChain.globalPoolDayPoolUsdt > 0
      ? onChain.globalPoolDayPoolUsdt
      : onChain.globalPoolBalanceUsdt ?? 0;

  return {
    totalPool: total,
    funding: { mode: "global_pool_contract", onChain }
  };
}

export type GlobalPoolOnChainPayoutResult = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  totalPaidUsdt: number;
  payoutSource: "global_pool" | "wallet" | "disabled";
  registrationHasReserveGetter: boolean;
  errors: Array<{ incomeId: string; userId: string; error: string }>;
  txHash?: string | null;
};

export type GlobalPoolOnChainBurnResult = {
  burnWallet: string | null;
  burnLogCount: number;
  totalBurnUsdt: number;
  sent: boolean;
  txHash: string | null;
  error: string | null;
};

/** Burn sink: env override → TREASURY. */
export async function resolveGlobalPoolBurnWallet(
  _client: PublicClient,
  _ignored?: Address
): Promise<Address | null> {
  const fromEnv = env.GLOBAL_POOL_BURN_WALLET_ADDRESS?.trim();
  if (fromEnv) return fromEnv as Address;
  const treasury = env.TREASURY_CONTRACT_ADDRESS?.trim();
  if (treasury) return treasury as Address;
  return null;
}

const RANK_TO_BUCKET: Record<GlobalRank, "prime" | "elite" | "royal" | "director" | "crown"> = {
  prime_member: "prime",
  elite_builder: "elite",
  royal_leader: "royal",
  global_director: "director",
  crown_ambassador: "crown"
};

/**
 * Call GlobalPool.distributeDay with candidate wallets from income ledger rows.
 * Empty ranks burn to Treasury inside the contract.
 */
export async function executeGlobalPoolOnChainPayouts(
  prisma: PrismaClient,
  globalPoolId: string
): Promise<GlobalPoolOnChainPayoutResult> {
  const out: GlobalPoolOnChainPayoutResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    totalPaidUsdt: 0,
    payoutSource: payoutFromGlobalPoolContract() ? "global_pool" : "wallet",
    registrationHasReserveGetter: false,
    errors: [],
    txHash: null
  };

  if (!globalPoolPayoutEnabled()) {
    return { ...out, payoutSource: "disabled", skipped: -1 };
  }

  const usdt = env.USDT_CONTRACT_ADDRESS as Address;
  const pool = env.GLOBAL_POOL_CONTRACT_ADDRESS as Address;
  const pk = globalPoolPayoutPrivateKey()!;
  const account = privateKeyToAccount(normalizePk(pk));
  const client = getPublicClient();
  const decimals = await readUsdtDecimals(client, usdt);

  const rows = await prisma.incomeLedger.findMany({
    where: {
      globalPoolId,
      incomeType: "global_pool",
      chainTxHash: null,
      status: { in: ["locked", "unlocked"] }
    },
    select: { id: true, userId: true, amount: true }
  });

  if (!rows.length) return out;

  const walletClient = createWalletClient({
    account,
    chain: appChain,
    transport: http(env.CHAIN_RPC_URL)
  });

  if (!payoutFromGlobalPoolContract()) {
    for (const row of rows) {
      out.attempted += 1;
      const amountUsdt = Number(row.amount);
      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
        out.skipped += 1;
        continue;
      }
      const wallet = await prisma.walletConnection.findFirst({
        where: { userId: row.userId, isPrimary: true },
        select: { walletAddress: true }
      });
      if (!wallet?.walletAddress) {
        out.skipped += 1;
        out.errors.push({ incomeId: row.id, userId: row.userId, error: "no_primary_wallet" });
        continue;
      }
      try {
        const amountWei = parseUnits(amountUsdt.toFixed(Math.min(decimals, 6)), decimals);
        const txHash = await walletClient.writeContract({
          account: account.address,
          chain: appChain,
          address: usdt,
          abi: erc20Abi,
          functionName: "transfer",
          args: [wallet.walletAddress as Address, amountWei]
        });
        await client.waitForTransactionReceipt({ hash: txHash, pollingInterval: 2_000, confirmations: 1 });
        await prisma.incomeLedger.update({
          where: { id: row.id },
          data: { chainTxHash: txHash, status: "unlocked" }
        });
        out.sent += 1;
        out.totalPaidUsdt += amountUsdt;
        out.txHash = txHash;
      } catch (e) {
        out.failed += 1;
        out.errors.push({
          incomeId: row.id,
          userId: row.userId,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
    return out;
  }

  const onChainOwner = await client.readContract({
    address: pool,
    abi: globalPoolAbi,
    functionName: "owner"
  });
  if (onChainOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `global pool: payout key ${account.address} is not GlobalPool owner ${onChainOwner}`
    );
  }

  const buckets: Record<"prime" | "elite" | "royal" | "director" | "crown", Address[]> = {
    prime: [],
    elite: [],
    royal: [],
    director: [],
    crown: []
  };

  const gp = await prisma.globalPool.findUnique({
    where: { id: globalPoolId },
    select: { day: true }
  });

  // Latest rankHistory row per user (no dedicated userRank table).
  const rankByUser = new Map<string, GlobalRank>();
  for (const row of rows) {
    if (rankByUser.has(row.userId)) continue;
    const hist = await prisma.rankHistory.findFirst({
      where: { userId: row.userId },
      orderBy: { achievedAt: "desc" },
      select: { rank: true }
    });
    if (hist?.rank) rankByUser.set(row.userId, hist.rank);
  }

  for (const row of rows) {
    out.attempted += 1;
    const rank = rankByUser.get(row.userId);
    if (!rank) {
      out.skipped += 1;
      out.errors.push({ incomeId: row.id, userId: row.userId, error: "no_rank" });
      continue;
    }
    const wallet = await prisma.walletConnection.findFirst({
      where: { userId: row.userId, isPrimary: true },
      select: { walletAddress: true }
    });
    if (!wallet?.walletAddress) {
      out.skipped += 1;
      out.errors.push({ incomeId: row.id, userId: row.userId, error: "no_primary_wallet" });
      continue;
    }
    buckets[RANK_TO_BUCKET[rank]].push(wallet.walletAddress as Address);
    out.totalPaidUsdt += Number(row.amount);
  }

  let day: bigint;
  try {
    const currentDay = await client.readContract({
      address: pool,
      abi: globalPoolAbi,
      functionName: "currentDay"
    });
    // Distribute previous completed day (contract requires day < currentDay).
    day = currentDay > 0n ? currentDay - 1n : 0n;
    if (gp?.day) {
      const utcDay = BigInt(Math.floor(new Date(gp.day).getTime() / 86_400_000));
      if (utcDay < currentDay) day = utcDay;
    }
  } catch (e) {
    out.failed += 1;
    out.errors.push({
      incomeId: "",
      userId: "",
      error: e instanceof Error ? e.message : "currentDay_failed"
    });
    return out;
  }

  try {
    const already = await client.readContract({
      address: pool,
      abi: globalPoolAbi,
      functionName: "dayDistributed",
      args: [day]
    });
    if (already) {
      out.skipped += rows.length;
      out.errors.push({ incomeId: "", userId: "", error: `day_${day}_already_distributed` });
      return out;
    }

    const txHash = await walletClient.writeContract({
      account: account.address,
      chain: appChain,
      address: pool,
      abi: globalPoolAbi,
      functionName: "distributeDay",
      args: [day, buckets.prime, buckets.elite, buckets.royal, buckets.director, buckets.crown]
    });
    await client.waitForTransactionReceipt({ hash: txHash, pollingInterval: 2_000, confirmations: 1 });

    await prisma.incomeLedger.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { chainTxHash: txHash, status: "unlocked" }
    });
    out.sent = rows.length - out.skipped - out.failed;
    out.txHash = txHash;
  } catch (e) {
    out.failed += 1;
    out.errors.push({
      incomeId: "",
      userId: "",
      error: e instanceof Error ? e.message : String(e)
    });
  }

  return out;
}

/**
 * Burns are handled inside GlobalPool.distributeDay (empty/unqualified → Treasury).
 * Marks pending burn logs with the distribute tx when available; otherwise no-op.
 */
export async function executeGlobalPoolOnChainBurnPayouts(
  prisma: PrismaClient,
  globalPoolId: string
): Promise<GlobalPoolOnChainBurnResult> {
  const empty: GlobalPoolOnChainBurnResult = {
    burnWallet: null,
    burnLogCount: 0,
    totalBurnUsdt: 0,
    sent: false,
    txHash: null,
    error: null
  };

  if (!globalPoolPayoutEnabled()) {
    return { ...empty, error: "on_chain_payout_disabled" };
  }

  const burnRows = await prisma.burnLog.findMany({
    where: { globalPoolId, chainTxHash: null },
    select: { id: true, amount: true }
  });
  if (!burnRows.length) return empty;

  const totalBurnUsdt = burnRows.reduce((s, r) => s + Number(r.amount), 0);
  const burnWallet = await resolveGlobalPoolBurnWallet(getPublicClient());

  // Prefer attaching the distributeDay tx from income rows if already paid.
  const paid = await prisma.incomeLedger.findFirst({
    where: { globalPoolId, chainTxHash: { not: null } },
    select: { chainTxHash: true }
  });
  if (paid?.chainTxHash) {
    await prisma.burnLog.updateMany({
      where: { id: { in: burnRows.map((r) => r.id) } },
      data: { chainTxHash: paid.chainTxHash }
    });
    return {
      burnWallet,
      burnLogCount: burnRows.length,
      totalBurnUsdt,
      sent: true,
      txHash: paid.chainTxHash,
      error: null
    };
  }

  return {
    burnWallet,
    burnLogCount: burnRows.length,
    totalBurnUsdt,
    sent: false,
    txHash: null,
    error:
      "burns settle via GlobalPool.distributeDay → Treasury; run distributeDay payout first (no legacy withdraw)"
  };
}
