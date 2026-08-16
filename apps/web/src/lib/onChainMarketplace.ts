/** NFTAIX NFTMarketplace client — buy(), listHeld(), setUserBot, USDT allowance. */
import {
  createWalletClient,
  custom,
  formatUnits,
  maxUint256,
  parseAbi,
  parseUnits,
  type Address
} from "viem";
import { marketplaceAbi } from "./abis/marketplaceAbi";
import { registrationAbi } from "./abis/registrationAbi";
import { createConfiguredPublicClient, ensureConfiguredOpbnbNetwork, getConfiguredOpbnbChain } from "./opbnb";
import { formatSubscribeSimulationError, gasOrFallback } from "./onChainSubscription";
import { DEFAULT_RECURRING_USDT_APPROVE_CAP } from "./usdtApprovalDefaults";
import { ensureWalletGas } from "./ensureWalletGas";
import { getInjectedProvider } from "./wallet";

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
]);

const USDT_DECIMALS = 18 as const;

export const OWN_LISTING_PURCHASE_ERROR =
  "You cannot buy an NFT you are selling. Wait for the next FIFO item or mint when the queue is empty.";

export function isOwnListingPurchaseError(err: unknown): boolean {
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes("own listing") || msg.includes(OWN_LISTING_PURCHASE_ERROR);
}

function normalizeAddr(a: string): string {
  return a.toLowerCase();
}

function formatMarketplaceError(err: unknown): string {
  const base = formatSubscribeSimulationError(err);
  const lower = base.toLowerCase();
  if (lower.includes("0x194bd314") || lower.includes("dailylimitexceeded")) {
    return "Daily trading limit reached for your package. Check Session tab (used vs allowance), upgrade your package, or wait for the next trading day.";
  }
  if (lower.includes("notactivated") || lower.includes("not activated")) {
    return "Activate a package first (Register / Upgrade), then buy NFTs.";
  }
  if (lower.includes("permanentlyinactive")) {
    return "Account is permanently inactive on-chain.";
  }
  return base;
}

async function ensureUsdtAllowance(params: {
  usdt: Address;
  spender: Address;
  account: Address;
  required: bigint;
  client: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createConfiguredPublicClient>;
  chain: ReturnType<typeof getConfiguredOpbnbChain>;
}) {
  const allowance = await params.publicClient.readContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "allowance",
    args: [params.account, params.spender]
  });
  if (allowance >= params.required) return;

  const gasApprove = await gasOrFallback(
    params.publicClient,
    {
      account: params.account,
      address: params.usdt,
      abi: erc20Abi,
      functionName: "approve",
      args: [params.spender, params.required]
    },
    120_000n
  );

  const approveHash = await params.client.writeContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "approve",
    args: [params.spender, params.required],
    account: params.account,
    chain: params.chain,
    gas: gasApprove
  });

  const receipt = await params.publicClient.waitForTransactionReceipt({
    hash: approveHash,
    pollingInterval: 2_000,
    confirmations: 1
  });
  if (receipt.status !== "success") {
    throw new Error("USDT approve failed on-chain.");
  }
}

async function assertActivated(registration: Address, account: Address) {
  const publicClient = createConfiguredPublicClient();
  const user = await publicClient.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "users",
    args: [account]
  });
  if (!user[0] || !user[1]) {
    throw new Error(
      "You must register and activate a package on the current Registration contract before buying an NFT. Open Register and pay the $5 entry with this wallet."
    );
  }
  if (user[2]) {
    throw new Error("Account is permanently inactive on-chain.");
  }
}

/** Next FIFO price (or mint ask when queue empty). */
export async function getNextNftPrice(marketplace: Address): Promise<bigint> {
  const entry = await peekNextBuyEntry(marketplace);
  return entry.price;
}

/** FIFO head (index 0) or primary mint ask when the queue is empty. */
export async function peekNextBuyEntry(marketplace: Address): Promise<{
  tokenId: string;
  price: bigint;
  seller: Address | null;
}> {
  const publicClient = createConfiguredPublicClient();
  const qLen = await publicClient.readContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "queueLength"
  });
  if (qLen === 0n) {
    const peek = await publicClient.readContract({
      address: marketplace,
      abi: marketplaceAbi,
      functionName: "peekNext"
    });
    return { tokenId: "next", price: peek[1], seller: null };
  }
  const entry = await publicClient.readContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "queueAt",
    args: [0n]
  });
  const sellerRaw = entry[2];
  const seller =
    sellerRaw && sellerRaw !== "0x0000000000000000000000000000000000000000"
      ? (sellerRaw as Address)
      : null;
  return { tokenId: entry[0].toString(), price: entry[1], seller };
}

/**
 * Approve USDT + `buy()` (FIFO / mint path).
 * `registration` optional — resolved from marketplace.registration() when omitted.
 */
export async function approveAndBuyNft(params: {
  marketplace: Address;
  usdt: Address;
  registration?: Address;
}): Promise<`0x${string}`> {
  const eth = getInjectedProvider();
  if (!eth) throw new Error("Wallet not available.");

  await ensureConfiguredOpbnbNetwork(eth, { refreshRpc: true });
  const chain = getConfiguredOpbnbChain();
  const client = createWalletClient({ chain, transport: custom(eth) });
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet.");

  await ensureWalletGas({ chainId: chain.id, address: account });

  const publicClient = createConfiguredPublicClient();

  const mpUsdt = await publicClient.readContract({
    address: params.marketplace,
    abi: marketplaceAbi,
    functionName: "usdt"
  });
  if (normalizeAddr(mpUsdt) !== normalizeAddr(params.usdt)) {
    throw new Error(
      `USDT mismatch: marketplace uses ${mpUsdt} but app passed ${params.usdt}.`
    );
  }

  const paused = await publicClient.readContract({
    address: params.marketplace,
    abi: marketplaceAbi,
    functionName: "paused"
  });
  if (paused) throw new Error("Marketplace is paused.");

  const registration =
    params.registration ||
    ((await publicClient.readContract({
      address: params.marketplace,
      abi: marketplaceAbi,
      functionName: "registration"
    })) as Address);

  await assertActivated(registration, account);

  const [userRow, day] = await Promise.all([
    publicClient.readContract({
      address: registration,
      abi: registrationAbi,
      functionName: "users",
      args: [account]
    }),
    publicClient.readContract({
      address: registration,
      abi: registrationAbi,
      functionName: "currentDay"
    })
  ]);
  const tradingLimit = userRow[5];
  const usedToday = await publicClient.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "dailyVolume",
    args: [account, day]
  });

  const nextEntry = await peekNextBuyEntry(params.marketplace);
  if (nextEntry.seller && normalizeAddr(nextEntry.seller) === normalizeAddr(account)) {
    throw new Error(OWN_LISTING_PURCHASE_ERROR);
  }

  const price = nextEntry.price;
  if (usedToday + price > tradingLimit) {
    const rem = tradingLimit > usedToday ? tradingLimit - usedToday : 0n;
    throw new Error(
      `Daily trading limit reached: used ${formatUnits(usedToday, USDT_DECIMALS)} USDT today, allowance ${formatUnits(tradingLimit, USDT_DECIMALS)} USDT (${formatUnits(rem, USDT_DECIMALS)} remaining). This buy needs ${formatUnits(price, USDT_DECIMALS)} USDT. Upgrade your package or wait for the next day.`
    );
  }

  const bal = await publicClient.readContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account]
  });
  if (bal < price) {
    throw new Error(`Insufficient USDT: need ${formatUnits(price, USDT_DECIMALS)}.`);
  }

  await ensureUsdtAllowance({
    usdt: params.usdt,
    spender: params.marketplace,
    account,
    required: price,
    client,
    publicClient,
    chain
  });

  try {
    await publicClient.simulateContract({
      account,
      address: params.marketplace,
      abi: marketplaceAbi,
      functionName: "buy"
    });
  } catch (e) {
    throw new Error(`buy would revert: ${formatMarketplaceError(e)}`);
  }

  const gas = await gasOrFallback(
    publicClient,
    {
      account,
      address: params.marketplace,
      abi: marketplaceAbi,
      functionName: "buy"
    },
    2_500_000n
  );

  const hash = await client.writeContract({
    address: params.marketplace,
    abi: marketplaceAbi,
    functionName: "buy",
    account,
    chain,
    gas
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 2_000,
    confirmations: 1
  });
  if (receipt.status !== "success") throw new Error("NFT buy failed on-chain.");
  return hash;
}

/** List currently held NFT into FIFO queue. */
export async function listHeldNft(params: { marketplace: Address }): Promise<`0x${string}`> {
  const eth = getInjectedProvider();
  if (!eth) throw new Error("Wallet not available.");
  await ensureConfiguredOpbnbNetwork(eth);
  const chain = getConfiguredOpbnbChain();
  const client = createWalletClient({ chain, transport: custom(eth) });
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet.");
  const publicClient = createConfiguredPublicClient();

  const held = await publicClient.readContract({
    address: params.marketplace,
    abi: marketplaceAbi,
    functionName: "heldTokenId",
    args: [account]
  });
  if (held === 0n) throw new Error("No held NFT to list.");

  const gas = await gasOrFallback(
    publicClient,
    {
      account,
      address: params.marketplace,
      abi: marketplaceAbi,
      functionName: "listHeld"
    },
    400_000n
  );

  const hash = await client.writeContract({
    address: params.marketplace,
    abi: marketplaceAbi,
    functionName: "listHeld",
    account,
    chain,
    gas
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
}

/** Approve USDT for marketplace spends (bot / recurring buys). */
export async function approveUsdtForMarketplaceSpend(params: {
  marketplace: Address;
  usdt: Address;
  mode?: "unlimited" | "limited";
  limitedAmount?: string;
}): Promise<{ approveTxHash: `0x${string}` | null }> {
  const eth = getInjectedProvider();
  if (!eth) throw new Error("Wallet not available.");
  await ensureConfiguredOpbnbNetwork(eth);
  const chain = getConfiguredOpbnbChain();
  const client = createWalletClient({ chain, transport: custom(eth) });
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet.");
  const publicClient = createConfiguredPublicClient();

  const mode = params.mode ?? "limited";
  const amount =
    mode === "unlimited"
      ? maxUint256
      : parseUnits(
          (params.limitedAmount ?? DEFAULT_RECURRING_USDT_APPROVE_CAP).trim() || "0",
          USDT_DECIMALS
        );

  const allowance = await publicClient.readContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, params.marketplace]
  });

  if (mode === "limited" && allowance >= amount) return { approveTxHash: null };
  if (mode === "unlimited" && allowance >= maxUint256 - 1n) return { approveTxHash: null };

  const gasApprove = await gasOrFallback(
    publicClient,
    {
      account,
      address: params.usdt,
      abi: erc20Abi,
      functionName: "approve",
      args: [params.marketplace, amount]
    },
    120_000n
  );

  const approveTxHash = await client.writeContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "approve",
    args: [params.marketplace, amount],
    account,
    chain,
    gas: gasApprove
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash, confirmations: 1 });
  return { approveTxHash };
}

/** Opt into bot — `setUserBot(user, enabled)`. */
export async function setMarketplaceAutoTrade(params: {
  marketplace: Address;
  enabled: boolean;
}): Promise<`0x${string}`> {
  const eth = getInjectedProvider();
  if (!eth) throw new Error("Wallet not available.");
  await ensureConfiguredOpbnbNetwork(eth);
  const chain = getConfiguredOpbnbChain();
  const client = createWalletClient({ chain, transport: custom(eth) });
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet.");
  const publicClient = createConfiguredPublicClient();

  const gas = await gasOrFallback(
    publicClient,
    {
      account,
      address: params.marketplace,
      abi: marketplaceAbi,
      functionName: "setUserBot",
      args: [account, params.enabled]
    },
    120_000n
  );

  const hash = await client.writeContract({
    address: params.marketplace,
    abi: marketplaceAbi,
    functionName: "setUserBot",
    args: [account, params.enabled],
    account,
    chain,
    gas
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
}

/** Read bot enrollment. */
export async function isMarketplaceAutoTradeEnabled(
  marketplace: Address,
  user: Address
): Promise<boolean> {
  const publicClient = createConfiguredPublicClient();
  return publicClient.readContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "botEnabled",
    args: [user]
  });
}
