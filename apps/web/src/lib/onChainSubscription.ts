import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  custom,
  formatUnits,
  parseAbi,
  type Address,
  type PublicClient
} from "viem";
import { registrationAbi } from "./abis/registrationAbi";
import { createConfiguredPublicClient, ensureConfiguredOpbnbNetwork, getConfiguredOpbnbChain } from "./opbnb";
import { getInjectedProvider } from "./wallet";

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
]);

function normalizeAddr(a: string): string {
  return a.toLowerCase();
}

/**
 * Wallets / JSON-RPC often surface only "Internal JSON-RPC error" and omit revert `data`.
 */
export function formatSubscribeSimulationError(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    if (reverted?.reason) return reverted.reason;
    if (reverted?.message && !reverted.message.includes("Internal JSON-RPC error")) {
      return reverted.message;
    }
    if (err.details && !err.details.includes("Internal JSON-RPC error")) return err.details;
    if (err.shortMessage && !err.shortMessage.includes("Internal JSON-RPC error")) return err.shortMessage;
  }
  if (err instanceof Error) {
    if (!err.message.includes("Internal JSON-RPC error")) return err.message;
  }
  return [
    "The chain/wallet did not return the revert reason (only “Internal JSON-RPC error”).",
    "Check: correct network, BNB for gas, USDT balance, and that package upgrade order is sequential."
  ].join(" ");
}

export async function gasOrFallback(
  publicClient: PublicClient,
  args: Parameters<PublicClient["estimateContractGas"]>[0],
  fallback: bigint
): Promise<bigint> {
  try {
    const est = await publicClient.estimateContractGas(args);
    if (est == null || est === 0n) return fallback;
    return (est * 130n) / 100n;
  } catch {
    return fallback;
  }
}

export async function ensureOpbnbTestnet(ethereum: NonNullable<Window["ethereum"]>): Promise<void> {
  await ensureConfiguredOpbnbNetwork(ethereum);
}

/**
 * Approve USDT then `activate(packageId)` (first package) or `upgrade(packageId)`.
 * `level` arg is package id (1 = $5 … 11 = $10k). `referrer` unused for upgrade (kept for call-site compat).
 */
export async function approveAndActivateOrUpgrade(params: {
  registration: Address;
  usdt: Address;
  referrer: Address;
  level: number;
}): Promise<`0x${string}`> {
  const registration = params.registration;
  const packageId = params.level;
  const eth = getInjectedProvider();
  if (!eth) throw new Error("Wallet not available.");

  if (!Number.isInteger(packageId) || packageId < 1 || packageId > 255) {
    throw new Error("Invalid package id.");
  }

  await ensureConfiguredOpbnbNetwork(eth);
  const chain = getConfiguredOpbnbChain();

  const client = createWalletClient({
    chain,
    transport: custom(eth)
  });

  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet.");

  const publicClient = createConfiguredPublicClient();

  const onChainUsdt = await publicClient.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "usdt"
  });
  if (normalizeAddr(onChainUsdt) !== normalizeAddr(params.usdt)) {
    throw new Error(
      `USDT mismatch: Registration uses ${onChainUsdt} but the app passed ${params.usdt}.`
    );
  }

  const user = await publicClient.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "users",
    args: [account]
  });
  const registered = user[0];
  const activated = user[1];

  if (!registered) {
    throw new Error("Wallet is not registered on-chain. Complete Register (register + activate) first.");
  }

  const pkg = await publicClient.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "packages",
    args: [packageId]
  });
  const required = pkg[0];
  if (!pkg[2] || required === 0n) {
    throw new Error(`Package ${packageId} is not configured.`);
  }

  const bal = await publicClient.readContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account]
  });
  if (bal < required) {
    throw new Error(
      `Insufficient USDT: need ${formatUnits(required, 18)} USDT for package ${packageId}.`
    );
  }

  const allowance = await publicClient.readContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, registration]
  });

  if (allowance < required) {
    const gasApprove = await gasOrFallback(
      publicClient,
      {
        account,
        address: params.usdt,
        abi: erc20Abi,
        functionName: "approve",
        args: [registration, required]
      },
      120_000n
    );

    const approveHash = await client.writeContract({
      address: params.usdt,
      abi: erc20Abi,
      functionName: "approve",
      args: [registration, required],
      account,
      chain,
      gas: gasApprove
    });

    await publicClient.waitForTransactionReceipt({
      hash: approveHash,
      pollingInterval: 2_000,
      confirmations: 1
    });
  }

  const fn = !activated ? "activate" : "upgrade";
  if (fn === "upgrade" && packageId <= Number(user[4])) {
    throw new Error(`Already on package ${Number(user[4])}. Next upgrade must be higher.`);
  }

  try {
    await publicClient.simulateContract({
      account,
      address: registration,
      abi: registrationAbi,
      functionName: fn,
      args: [packageId]
    });
  } catch (simErr) {
    throw new Error(`${fn} would revert: ${formatSubscribeSimulationError(simErr)}`);
  }

  const gasTx = await gasOrFallback(
    publicClient,
    {
      account,
      address: registration,
      abi: registrationAbi,
      functionName: fn,
      args: [packageId]
    },
    2_500_000n
  );

  try {
    const hash = await client.writeContract({
      address: registration,
      abi: registrationAbi,
      functionName: fn,
      args: [packageId],
      account,
      chain,
      gas: gasTx
    });
    return hash;
  } catch (writeErr) {
    throw new Error(formatSubscribeSimulationError(writeErr));
  }
}
