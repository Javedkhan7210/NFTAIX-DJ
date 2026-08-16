import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export type OpbnbNetworkKey = "bscTestnet" | "testnet" | "mainnet";

/** NFTAIX 6-contract stack (+ USDT). */
export type OpbnbNetworkContracts = {
  usdt: string | null;
  registration: string | null;
  marketplace: string | null;
  rewards: string | null;
  globalPool: string | null;
  treasury: string | null;
  liquidityManager: string | null;
  marketplaceImpl: string | null;
  nftaixToken: string | null;
};

export type OpbnbNetworkPreset = {
  key: OpbnbNetworkKey;
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  deploymentFile: string;
  contracts: OpbnbNetworkContracts;
  apiEnvExample: string[];
  webEnvExample: string[];
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function findDeploymentsDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "packages/contracts/deployments"),
    path.resolve(process.cwd(), "../packages/contracts/deployments"),
    path.resolve(process.cwd(), "../../packages/contracts/deployments"),
    path.resolve(MODULE_DIR, "../../../../../packages/contracts/deployments"),
    path.resolve(MODULE_DIR, "../../../../../../packages/contracts/deployments"),
    path.resolve(process.cwd(), "deployments"),
    path.resolve(MODULE_DIR, "../../../../deployments")
  ];
  for (const dir of candidates) {
    if (
      existsSync(path.join(dir, "bsc-testnet-nftaix-stack.json")) ||
      existsSync(path.join(dir, "opbnb-mainnet-stack.json"))
    ) {
      return dir;
    }
  }
  return null;
}

function readDeploymentJson(filename: string): Record<string, unknown> | null {
  const dir = findDeploymentsDir();
  if (!dir) return null;
  try {
    const raw = readFileSync(path.join(dir, filename), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function addr(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("0x") ? v : null;
}

function contractsFromStack(data: Record<string, unknown> | null): OpbnbNetworkContracts | null {
  if (!data) return null;
  return {
    usdt: addr(data.usdt) ?? addr(data.mockUSDT),
    registration: addr(data.registration),
    marketplace: addr(data.marketplace),
    rewards: addr(data.rewards),
    globalPool: addr(data.globalPool),
    treasury: addr(data.treasury),
    liquidityManager: addr(data.liquidityManager),
    marketplaceImpl: addr(data.marketplaceImpl),
    nftaixToken: addr(data.nftaixToken)
  };
}

const EMPTY: OpbnbNetworkContracts = {
  usdt: null,
  registration: null,
  marketplace: null,
  rewards: null,
  globalPool: null,
  treasury: null,
  liquidityManager: null,
  marketplaceImpl: null,
  nftaixToken: null
};

function mergeContracts(
  fallback: OpbnbNetworkContracts,
  fromFile: OpbnbNetworkContracts | null
): OpbnbNetworkContracts {
  if (!fromFile) return fallback;
  const out = { ...fallback };
  for (const k of Object.keys(out) as (keyof OpbnbNetworkContracts)[]) {
    if (fromFile[k]) out[k] = fromFile[k];
  }
  return out;
}

function buildPreset(
  key: OpbnbNetworkKey,
  chainId: number,
  name: string,
  rpcUrl: string,
  explorerUrl: string,
  deploymentFile: string,
  fallback: OpbnbNetworkContracts,
  stackFilename: string
): OpbnbNetworkPreset {
  const contracts = mergeContracts(fallback, contractsFromStack(readDeploymentJson(stackFilename)));
  return {
    key,
    chainId,
    name,
    rpcUrl,
    explorerUrl,
    deploymentFile,
    contracts,
    apiEnvExample: [
      `CHAIN_ID=${chainId}`,
      `CHAIN_RPC_URL=${rpcUrl}`,
      `USDT_CONTRACT_ADDRESS=${contracts.usdt ?? ""}`,
      `REGISTRATION_CONTRACT_ADDRESS=${contracts.registration ?? ""}`,
      `MARKETPLACE_CONTRACT_ADDRESS=${contracts.marketplace ?? ""}`,
      `REWARDS_CONTRACT_ADDRESS=${contracts.rewards ?? ""}`,
      `GLOBAL_POOL_CONTRACT_ADDRESS=${contracts.globalPool ?? ""}`,
      `TREASURY_CONTRACT_ADDRESS=${contracts.treasury ?? ""}`,
      `LIQUIDITY_MANAGER_CONTRACT_ADDRESS=${contracts.liquidityManager ?? ""}`
    ],
    webEnvExample: [
      `VITE_OPBNB_CHAIN_ID=${chainId}`,
      `VITE_OPBNB_RPC_URL=${rpcUrl}`,
      `VITE_OPBNB_EXPLORER_URL=${explorerUrl}`
    ]
  };
}

/** BNB Smart Chain Testnet (not opBNB L2). Addresses filled after deploy. */
export const BSC_TESTNET = buildPreset(
  "bscTestnet",
  97,
  "BNB Smart Chain Testnet",
  "https://data-seed-prebsc-1-s1.binance.org:8545",
  "https://testnet.bscscan.com",
  "packages/contracts/deployments/bsc-testnet-nftaix-stack.json",
  EMPTY,
  "bsc-testnet-nftaix-stack.json"
);

export const OPBNB_TESTNET = buildPreset(
  "testnet",
  5611,
  "opBNB Testnet",
  "https://opbnb-testnet-rpc.bnbchain.org",
  "https://testnet.opbnbscan.com",
  "deployments/opbnb-testnet-nftaix-stack.json",
  EMPTY,
  "opbnb-testnet-nftaix-stack.json"
);

export const OPBNB_MAINNET = buildPreset(
  "mainnet",
  204,
  "opBNB Mainnet",
  "https://opbnb-mainnet-rpc.bnbchain.org",
  "https://opbnb.bscscan.com",
  "packages/contracts/deployments/opbnb-mainnet-stack.json",
  EMPTY,
  "opbnb-mainnet-stack.json"
);

export const OPBNB_NETWORKS: OpbnbNetworkPreset[] = [BSC_TESTNET, OPBNB_TESTNET, OPBNB_MAINNET];

/** Admin overview: hide testnet when the API runs on mainnet (live). */
export function opbnbNetworksForAdminOverview(activeChainId: number): OpbnbNetworkPreset[] {
  if (activeChainId === OPBNB_MAINNET.chainId) {
    return [OPBNB_MAINNET];
  }
  return OPBNB_NETWORKS;
}

export function opbnbPresetForChainId(chainId: number): OpbnbNetworkPreset | undefined {
  return OPBNB_NETWORKS.find((n) => n.chainId === chainId);
}

/** Prefer non-null fields from `override` (e.g. API `.env` on the active network). */
export function mergeNetworkContracts(
  base: OpbnbNetworkContracts,
  override: Partial<OpbnbNetworkContracts> | null | undefined
): OpbnbNetworkContracts {
  if (!override) return base;
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof OpbnbNetworkContracts)[]) {
    const v = override[k];
    if (v) out[k] = v;
  }
  return out;
}
