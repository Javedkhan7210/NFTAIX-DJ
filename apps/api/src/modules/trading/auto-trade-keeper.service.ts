/**
 * Bot keeper for new NFTMarketplace: owner/bot calls `runBot(user, maxTrades)`.
 * Users must `setUserBot(true)` and approve USDT to the marketplace.
 */
import { createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/db/prisma.js";
import { appChain, getPublicClient } from "../chain/chain-viem.js";
import { marketplaceAbi } from "../chain/marketplace-abi.js";
import { registrationAbi } from "../chain/registration-abi.js";

function executorKey(): string | undefined {
  return (
    env.AUTO_TRADE_EXECUTOR_PRIVATE_KEY?.trim() ||
    env.MARKETPLACE_OWNER_PRIVATE_KEY?.trim() ||
    env.CHAIN_PRIVATE_KEY?.trim()
  );
}

type KeeperClients = {
  publicClient: PublicClient;
  wallet: ReturnType<typeof createWalletClient>;
  mp: `0x${string}`;
  reg: `0x${string}`;
};

async function getKeeperClients(): Promise<KeeperClients | null> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const reg = env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const key = executorKey();
  if (!mp || !reg || !key) return null;

  const account = privateKeyToAccount(key.startsWith("0x") ? (key as `0x${string}`) : `0x${key}`);
  const publicClient = getPublicClient();
  const wallet = createWalletClient({
    account,
    chain: appChain,
    transport: http(env.CHAIN_RPC_URL)
  });

  try {
    const isBot = await publicClient.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "isBot",
      args: [account.address]
    });
    if (!isBot) {
      const owner = await publicClient.readContract({
        address: mp,
        abi: marketplaceAbi,
        functionName: "owner"
      });
      if (owner.toLowerCase() === account.address.toLowerCase()) {
        const hash = await wallet.writeContract({
          address: mp,
          abi: marketplaceAbi,
          functionName: "setBot",
          args: [account.address, true]
        });
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        throw new Error(`Executor ${account.address} is not marketplace isBot/owner — call setBot first`);
      }
    }
  } catch (e) {
    throw new Error(`setBot check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { publicClient, wallet, mp, reg };
}

/** Calls NFTMarketplace.runBot for one wallet. */
export async function runBotForWallet(
  walletAddr: `0x${string}`,
  maxTrades: number
): Promise<{ txHash: `0x${string}` }> {
  const clients = await getKeeperClients();
  if (!clients) {
    throw new Error("MARKETPLACE_CONTRACT_ADDRESS / REGISTRATION / executor key required");
  }
  const { publicClient, wallet, mp } = clients;
  const hash = await wallet.writeContract({
    address: mp,
    abi: marketplaceAbi,
    functionName: "runBot",
    args: [walletAddr, BigInt(Math.max(1, maxTrades))]
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash };
}

/** Admin / cron: runBot for eligible active users with botEnabled on-chain. */
export async function runAutoTradeKeeperOnce(): Promise<{
  usersTried: number;
  buys: number;
  errors: string[];
}> {
  const clients = await getKeeperClients();
  const errors: string[] = [];
  let buys = 0;
  let usersTried = 0;

  if (!clients) {
    return {
      usersTried: 0,
      buys: 0,
      errors: ["MARKETPLACE_CONTRACT_ADDRESS / REGISTRATION / executor key required"]
    };
  }

  const { publicClient, mp, reg } = clients;
  const maxTrades = Math.max(1, Number(env.BOT_SEQUENTIAL_MAX_PURCHASES_PER_USER ?? 10));

  const users = await prisma.user.findMany({
    where: { isActive: true, blockedReason: null },
    select: {
      id: true,
      walletConnections: {
        where: { blocked: false },
        select: { walletAddress: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }]
      }
    },
    take: 200
  });

  for (const u of users) {
    const walletAddr = u.walletConnections[0]?.walletAddress as `0x${string}` | undefined;
    if (!walletAddr) continue;

    try {
      const enabled = await publicClient.readContract({
        address: mp,
        abi: marketplaceAbi,
        functionName: "botEnabled",
        args: [walletAddr]
      });
      if (!enabled) continue;

      const user = await publicClient.readContract({
        address: reg,
        abi: registrationAbi,
        functionName: "users",
        args: [walletAddr]
      });
      if (!user[1] || user[2]) continue;

      usersTried += 1;
      const { txHash } = await runBotForWallet(walletAddr, maxTrades);
      buys += 1;
      logger.info({ user: walletAddr, hash: txHash }, "runBot ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${walletAddr}: ${msg}`);
      logger.warn({ err: e, walletAddr }, "runBot failed");
    }
  }

  return { usersTried, buys, errors };
}

/** Compat alias for job-runner / legacy keeper naming. */
export const runAutoTradeKeeper = runAutoTradeKeeperOnce;

/** Legacy primary-buy path — runBot on marketplace handles primary + resale internally. */
export async function runAutoTradePrimaryBuys(): Promise<{ skipped: string }> {
  return { skipped: "Primary buys are handled by NFTMarketplace.runBot; no separate keeper path" };
}

/** Admin "Trade Now" primary path: single botBuy for one wallet. */
export async function runManualBotBuy(buyer: `0x${string}`): Promise<{ txHash: `0x${string}` }> {
  const clients = await getKeeperClients();
  if (!clients) throw new Error("Marketplace or executor key missing");

  const { publicClient, wallet, mp } = clients;
  const hash = await wallet.writeContract({
    address: mp,
    abi: marketplaceAbi,
    functionName: "botBuy",
    args: [buyer]
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash };
}
