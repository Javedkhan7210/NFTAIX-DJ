import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";

/** Public RPCs may abort slow `eth_call` (e.g. marketplace `buy` simulation). */
const HTTP_TRANSPORT_TIMEOUT_MS = 120_000;

/** Default explorer when `VITE_OPBNB_EXPLORER_URL` is unset (opBNB mainnet). */
const DEFAULT_EXPLORER_BASE = "https://opbnb.bscscan.com";

/** opBNB testnet (use `npm run deploy:nftaix:testnet` in packages/contracts). */
export const opbnbTestnet = defineChain({
  id: 5611,
  name: "opBNB Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://opbnb-testnet-rpc.bnbchain.org"] } },
  blockExplorers: { default: { name: "opBNBScan", url: "https://testnet.opbnbscan.com" } }
});

/** opBNB mainnet. */
export const opbnbMainnet = defineChain({
  id: 204,
  name: "opBNB Mainnet",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://opbnb-mainnet-rpc.bnbchain.org"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://opbnb.bscscan.com" } }
});

/** BNB Smart Chain Testnet (MetaMask: "BNB Smart Chain Testnet", not opBNB L2). */
export const bscTestnet = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://data-seed-prebsc-1-s1.binance.org:8545"] }
  },
  blockExplorers: { default: { name: "BscScan", url: "https://testnet.bscscan.com" } }
});

const KNOWN_CHAINS: Record<number, Chain> = {
  [bscTestnet.id]: bscTestnet,
  [opbnbTestnet.id]: opbnbTestnet,
  [opbnbMainnet.id]: opbnbMainnet
};

function configuredChainId(): number {
  const raw = Number(import.meta.env.VITE_OPBNB_CHAIN_ID ?? 5611);
  return Number.isFinite(raw) ? raw : 5611;
}

function configuredRpcUrl(): string | undefined {
  const raw = (import.meta.env.VITE_OPBNB_RPC_URL as string | undefined)?.trim();
  return raw ? raw : undefined;
}

function chainWithOptionalRpc(base: Chain): Chain {
  const rpc = configuredRpcUrl();
  if (!rpc) return base;
  return defineChain({
    ...base,
    rpcUrls: { default: { http: [rpc] } }
  });
}

/** Resolve chain metadata for a chain id (API `chainId` or env). */
export function getChainById(chainId: number): Chain {
  const base = KNOWN_CHAINS[chainId];
  if (base) return chainWithOptionalRpc(base);
  const rpc = configuredRpcUrl() ?? opbnbMainnet.rpcUrls.default.http[0];
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } }
  });
}

export function getConfiguredOpbnbChain(): Chain {
  return getChainById(configuredChainId());
}

export function createConfiguredPublicClient(): PublicClient {
  const chain = getConfiguredOpbnbChain();
  const url = chain.rpcUrls.default.http[0];
  return createPublicClient({
    chain,
    transport: http(url, { timeout: HTTP_TRANSPORT_TIMEOUT_MS, retryCount: 2 })
  });
}

/**
 * Use the API's `chainId` for read-only calls (e.g. Registration sponsor checks).
 * Avoids `VITE_OPBNB_CHAIN_ID` pointing at a different chain than `REGISTRATION_CONTRACT_ADDRESS`.
 */
export function createPublicClientForChainId(chainId: number): PublicClient {
  const chain = getChainById(chainId);
  const url = chain.rpcUrls.default.http[0];
  return createPublicClient({
    chain,
    transport: http(url, { timeout: HTTP_TRANSPORT_TIMEOUT_MS, retryCount: 2 })
  });
}

type EnsureConfiguredOpbnbNetworkOptions = {
  /**
   * MetaMask does not update a saved network's RPC URL when we only call
   * `wallet_switchEthereumChain`. Primary NFT mint is heavy enough that stale
   * public RPCs often fail during wallet simulation, so refresh from env first.
   */
  refreshRpc?: boolean;
};

async function addEthereumChain(ethereum: NonNullable<Window["ethereum"]>, chain: Chain): Promise<void> {
  await ethereum.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: `0x${chain.id.toString(16)}`,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: [chain.blockExplorers?.default.url ?? DEFAULT_EXPLORER_BASE]
      }
    ]
  });
}

async function ensureEthereumNetwork(
  ethereum: NonNullable<Window["ethereum"]>,
  chain: Chain,
  options: EnsureConfiguredOpbnbNetworkOptions = {}
): Promise<void> {
  const chainIdHex = `0x${chain.id.toString(16)}`;

  if (options.refreshRpc && configuredRpcUrl()) {
    try {
      await addEthereumChain(ethereum, chain);
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err?.code === 4001) throw e;
    }
  }

  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code === 4902) {
      await addEthereumChain(ethereum, chain);
      await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } else {
      throw e;
    }
  }
}

/** Switch wallet to the chain the API uses (e.g. registration `chainId`). */
export async function ensureNetworkForChainId(
  ethereum: NonNullable<Window["ethereum"]>,
  chainId: number,
  options: EnsureConfiguredOpbnbNetworkOptions = {}
): Promise<void> {
  await ensureEthereumNetwork(ethereum, getChainById(chainId), options);
}

export async function ensureConfiguredOpbnbNetwork(
  ethereum: NonNullable<Window["ethereum"]>,
  options: EnsureConfiguredOpbnbNetworkOptions = {}
): Promise<void> {
  await ensureEthereumNetwork(ethereum, getConfiguredOpbnbChain(), options);
}

/** Block explorer base URL (env override, else chainId hint, else mainnet default). */
export function getOpbnbExplorerBase(chainId?: number): string {
  const fromEnv = (import.meta.env.VITE_OPBNB_EXPLORER_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (chainId === bscTestnet.id) return bscTestnet.blockExplorers.default.url;
  if (chainId === opbnbTestnet.id) return opbnbTestnet.blockExplorers.default.url;
  return DEFAULT_EXPLORER_BASE;
}

/**
 * Transaction URL on the block explorer (testnet or mainnet).
 * Set `VITE_OPBNB_EXPLORER_URL` in `apps/web/.env`, e.g. `https://opbnb.bscscan.com` for mainnet.
 */
export function opbnbExplorerTx(hash: string, chainId?: number): string {
  const base = getOpbnbExplorerBase(chainId);
  const h = hash.trim();
  return `${base}/tx/${h}`;
}

/** Contract / wallet address on opBNBScan (or configured explorer). */
export function opbnbExplorerAddress(address: string, chainId?: number): string {
  const base = getOpbnbExplorerBase(chainId);
  return `${base}/address/${address.trim()}`;
}

/** @deprecated Use {@link opbnbExplorerTx} so mainnet vs testnet comes from env. */
export function opbnbTestnetExplorerTx(hash: string): string {
  return opbnbExplorerTx(hash);
}
