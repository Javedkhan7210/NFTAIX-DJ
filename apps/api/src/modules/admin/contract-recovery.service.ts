import { createWalletClient, formatUnits, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../shared/config/env.js";
import { appChain, getPublicClient } from "../chain/chain-viem.js";

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
]);

const recoverAbi = parseAbi(["function recoverErc20(address erc20Token, uint256 amount) external"]);

/** New 6-contract stack recovery targets (+ marketplace ERC-721 is the NFT). */
export type RecoveryTarget =
  | "registration"
  | "marketplace"
  | "rewards"
  | "globalPool"
  | "treasury"
  | "liquidityManager";

export type ContractUsdtBalanceRow = {
  target: RecoveryTarget;
  contractAddress: string | null;
  balanceWei: string | null;
  balanceFormatted: string | null;
  error?: string;
};

function recoverySignerPk(): `0x${string}` {
  const raw =
    env.CONTRACT_ADMIN_PRIVATE_KEY?.trim() ||
    env.CHAIN_PRIVATE_KEY.trim();
  if (!raw) {
    throw Object.assign(new Error("No recovery private key (set CONTRACT_ADMIN_PRIVATE_KEY, or CHAIN_PRIVATE_KEY)"), {
      status: 503
    });
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function contractAddressFor(target: RecoveryTarget): `0x${string}` | undefined {
  switch (target) {
    case "registration":
      return env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}` | undefined;
    case "marketplace":
      return env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
    case "rewards":
      return env.REWARDS_CONTRACT_ADDRESS as `0x${string}` | undefined;
    case "globalPool":
      return env.GLOBAL_POOL_CONTRACT_ADDRESS as `0x${string}` | undefined;
    case "treasury":
      return env.TREASURY_CONTRACT_ADDRESS as `0x${string}` | undefined;
    case "liquidityManager":
      return env.LIQUIDITY_MANAGER_CONTRACT_ADDRESS as `0x${string}` | undefined;
    default:
      return undefined;
  }
}

const ALL_TARGETS: RecoveryTarget[] = [
  "registration",
  "marketplace",
  "rewards",
  "globalPool",
  "treasury",
  "liquidityManager"
];

export class ContractRecoveryService {
  async getUsdtBalances(): Promise<{
    usdtToken: string | null;
    decimals: number;
    rows: ContractUsdtBalanceRow[];
    dedicatedRecoverKey: boolean;
  }> {
    const usdt = env.USDT_CONTRACT_ADDRESS ?? null;
    const dedicatedRecoverKey = Boolean(
       env.CONTRACT_ADMIN_PRIVATE_KEY?.trim()
    );
    const decimals = env.USDT_DECIMALS;
    const client = getPublicClient();

    if (!usdt) {
      return {
        usdtToken: null,
        decimals,
        dedicatedRecoverKey,
        rows: ALL_TARGETS.map((target) => ({
          target,
          contractAddress: contractAddressFor(target) ?? null,
          balanceWei: null,
          balanceFormatted: null,
          error: "USDT_CONTRACT_ADDRESS not set"
        }))
      };
    }

    let onChainDecimals = decimals;
    try {
      onChainDecimals = Number(await client.readContract({ address: usdt as `0x${string}`, abi: erc20Abi, functionName: "decimals" }));
      if (!Number.isFinite(onChainDecimals) || onChainDecimals < 0) onChainDecimals = decimals;
    } catch {
      /* use env */
    }

    const rows: ContractUsdtBalanceRow[] = [];

    for (const target of ALL_TARGETS) {
      const addr = contractAddressFor(target);
      if (!addr) {
        rows.push({
          target,
          contractAddress: null,
          balanceWei: null,
          balanceFormatted: null,
          error: "Contract address not in env"
        });
        continue;
      }
      try {
        const balanceWei = await client.readContract({
          address: usdt as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [addr]
        });
        rows.push({
          target,
          contractAddress: addr,
          balanceWei: balanceWei.toString(),
          balanceFormatted: formatUnits(balanceWei, onChainDecimals)
        });
      } catch (e) {
        rows.push({
          target,
          contractAddress: addr,
          balanceWei: null,
          balanceFormatted: null,
          error: e instanceof Error ? e.message : "balanceOf failed"
        });
      }
    }

    return { usdtToken: usdt, decimals: onChainDecimals, rows, dedicatedRecoverKey };
  }

  /**
   * Calls `recoverErc20` on the chosen contract when supported.
   * `amount` is human USDT string (e.g. "12.5") or "all" for full balance.
   */
  async recoverUsdt(target: RecoveryTarget, amount: "all" | string): Promise<{ txHash: `0x${string}` }> {
    const usdt = env.USDT_CONTRACT_ADDRESS;
    if (!usdt) {
      throw Object.assign(new Error("USDT_CONTRACT_ADDRESS not configured"), { status: 503 });
    }
    const contractAddr = contractAddressFor(target);
    if (!contractAddr) {
      throw Object.assign(new Error(`No contract address in env for target "${target}"`), { status: 400 });
    }

    const client = getPublicClient();
    let tokenDecimals = env.USDT_DECIMALS;
    try {
      tokenDecimals = Number(await client.readContract({ address: usdt as `0x${string}`, abi: erc20Abi, functionName: "decimals" }));
    } catch {
      /* env */
    }

    const bal = await client.readContract({
      address: usdt as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [contractAddr]
    });
    const amountWei =
      amount === "all" ? bal : parseUnits(String(amount), tokenDecimals);
    if (amountWei <= 0n) {
      throw Object.assign(new Error("Amount must be positive"), { status: 400 });
    }
    if (amountWei > bal) {
      throw Object.assign(new Error("Amount exceeds contract USDT balance"), { status: 400 });
    }

    const account = privateKeyToAccount(recoverySignerPk());
    const walletClient = createWalletClient({
      account,
      chain: appChain,
      transport: http(env.CHAIN_RPC_URL)
    });

    try {
      const txHash = await walletClient.writeContract({
        address: contractAddr,
        abi: recoverAbi,
        functionName: "recoverErc20",
        args: [usdt as `0x${string}`, amountWei]
      });
      return { txHash };
    } catch (e) {
      throw Object.assign(
        new Error(
          `recoverErc20 failed on ${target}: ${e instanceof Error ? e.message : String(e)}. New-stack contracts may not expose recoverErc20.`
        ),
        { status: 502 }
      );
    }
  }
}
