import { createPublicClient, defineChain, formatUnits, http, parseAbi } from "viem";
import { env } from "../../shared/config/env.js";
import {
  mergeNetworkContracts,
  opbnbNetworksForAdminOverview,
  type OpbnbNetworkContracts,
  type OpbnbNetworkPreset
} from "../chain/opbnb-network-presets.js";

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
]);

type BalanceRow = {
  target: string;
  label: string;
  contractAddress: string | null;
  balanceFormatted: string | null;
  error?: string;
};

const BALANCE_TARGETS: Array<{ key: keyof OpbnbNetworkContracts; label: string; target: string }> = [
  { key: "registration", label: "Registration", target: "registration" },
  { key: "marketplace", label: "Marketplace", target: "marketplace" },
  { key: "rewards", label: "Rewards", target: "rewards" },
  { key: "globalPool", label: "Global pool", target: "globalPool" },
  { key: "treasury", label: "Treasury", target: "treasury" },
  { key: "liquidityManager", label: "Liquidity manager", target: "liquidityManager" }
];

async function fetchPresetBalances(
  preset: OpbnbNetworkPreset,
  contracts: OpbnbNetworkContracts
): Promise<{
  usdtToken: string | null;
  rows: BalanceRow[];
}> {
  const usdt = contracts.usdt;
  if (!usdt) {
    return {
      usdtToken: null,
      rows: BALANCE_TARGETS.map(({ key, label, target }) => ({
        target,
        label,
        contractAddress: contracts[key],
        balanceFormatted: null,
        error: "USDT token address not configured"
      }))
    };
  }

  const chain = defineChain({
    id: preset.chainId,
    name: preset.name,
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [preset.rpcUrl] } }
  });

  const client = createPublicClient({
    chain,
    transport: http(preset.rpcUrl, { timeout: 60_000 })
  });

  let decimals = env.USDT_DECIMALS;
  try {
    decimals = Number(
      await client.readContract({
        address: usdt as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals"
      })
    );
  } catch {
    /* env default */
  }

  const rows: BalanceRow[] = [];
  for (const { key, label, target } of BALANCE_TARGETS) {
    const contractAddress = contracts[key];
    if (!contractAddress) {
      rows.push({ target, label, contractAddress: null, balanceFormatted: null, error: "Address not configured" });
      continue;
    }
    try {
      const balanceWei = await client.readContract({
        address: usdt as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [contractAddress as `0x${string}`]
      });
      rows.push({
        target,
        label,
        contractAddress,
        balanceFormatted: formatUnits(balanceWei, decimals)
      });
    } catch (e) {
      rows.push({
        target,
        label,
        contractAddress,
        balanceFormatted: null,
        error: e instanceof Error ? e.message : "balanceOf failed"
      });
    }
  }

  return { usdtToken: usdt, rows };
}

function activeContractsFromEnv(): OpbnbNetworkContracts {
  return {
    usdt: env.USDT_CONTRACT_ADDRESS ?? null,
    registration: env.REGISTRATION_CONTRACT_ADDRESS ?? null,
    marketplace: env.MARKETPLACE_CONTRACT_ADDRESS ?? null,
    rewards: env.REWARDS_CONTRACT_ADDRESS ?? null,
    globalPool: env.GLOBAL_POOL_CONTRACT_ADDRESS ?? null,
    treasury: env.TREASURY_CONTRACT_ADDRESS ?? null,
    liquidityManager: env.LIQUIDITY_MANAGER_CONTRACT_ADDRESS ?? null,
    marketplaceImpl: env.MARKETPLACE_IMPL_ADDRESS ?? null,
    nftaixToken: env.NFTAIX_TOKEN_ADDRESS ?? null
  };
}

export async function getAdminNetworksOverview() {
  const activeChainId = env.CHAIN_ID;
  const activeRpcHost = (() => {
    try {
      return new URL(env.CHAIN_RPC_URL).host;
    } catch {
      return env.CHAIN_RPC_URL;
    }
  })();

  const envContracts = activeContractsFromEnv();

  const presets = opbnbNetworksForAdminOverview(activeChainId);

  const networks = await Promise.all(
    presets.map(async (preset) => {
      const isActive = preset.chainId === activeChainId;
      const displayContracts = isActive
        ? mergeNetworkContracts(preset.contracts, envContracts)
        : preset.contracts;
      const balances = await fetchPresetBalances(preset, displayContracts);
      return {
        ...preset,
        contracts: displayContracts,
        isActive,
        liveContracts: isActive ? envContracts : null,
        liveRpcHost: isActive ? activeRpcHost : null,
        balances
      };
    })
  );

  return { activeChainId, networks };
}
