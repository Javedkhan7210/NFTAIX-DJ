import { createWalletClient, custom, formatUnits, parseAbi, parseUnits, type Address } from "viem";
import { ENTRY_PACKAGE_ID, registrationAbi } from "./abis/registrationAbi";
import {
  createPublicClientForChainId,
  ensureNetworkForChainId,
  getChainById
} from "./opbnb";
import { checkRegistrationActivateGate } from "./registrationPreflight";
import { formatSubscribeSimulationError, gasOrFallback } from "./onChainSubscription";
import { getInjectedProvider } from "./wallet";

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(address to, uint256 amount)"
]);

function normalizeAddr(a: string): string {
  return a.toLowerCase();
}

/**
 * One-step on-chain signup: USDT approve + `registerAndActivate(sponsor, packageId)`.
 * Returns the activate/registerAndActivate tx hash for API verification.
 */
export async function approveAndPayRegistration(params: {
  registration: Address;
  usdt: Address;
  referrer: Address;
  chainId: number;
}): Promise<`0x${string}`> {
  const registration = params.registration;
  let eth: ReturnType<typeof getInjectedProvider>;
  try {
    eth = getInjectedProvider();
  } catch {
    throw new Error("Wallet not available.");
  }

  await ensureNetworkForChainId(eth as NonNullable<Window["ethereum"]>, params.chainId);
  const chain = getChainById(params.chainId);

  const requested = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const fromRequest = requested[0]?.trim();
  if (!fromRequest || !/^0x[a-fA-F0-9]{40}$/.test(fromRequest)) {
    throw new Error("Connect your wallet and select an account.");
  }

  const client = createWalletClient({
    account: fromRequest as Address,
    chain,
    transport: custom(eth)
  });

  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet.");

  const gate = await checkRegistrationActivateGate(registration, account as Address, params.chainId);
  if (!gate.ok) {
    throw new Error(gate.message);
  }
  if (gate.requiredPackageId !== ENTRY_PACKAGE_ID) {
    throw new Error(
      `This wallet is already activated (package ${gate.currentPackageId}). Use Sign in, or upgrade from the Upgrade page (next package ${gate.requiredPackageId}).`
    );
  }

  const publicClient = createPublicClientForChainId(params.chainId);

  const onChainUsdt = await publicClient.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "usdt"
  });
  if (normalizeAddr(onChainUsdt) !== normalizeAddr(params.usdt)) {
    throw new Error(
      `USDT mismatch: Registration uses ${onChainUsdt} but the app passed ${params.usdt}. Align USDT_CONTRACT_ADDRESS.`
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
  if (activated) {
    throw new Error("This wallet is already activated on-chain. Please sign in instead.");
  }

  if (registered) {
    const sponsor = user[3];
    if (normalizeAddr(sponsor) !== normalizeAddr(params.referrer)) {
      throw new Error(
        `Wallet already registered under a different sponsor (${sponsor}). Use that signup path or a new wallet.`
      );
    }
  }

  const pkg = await publicClient.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "packages",
    args: [ENTRY_PACKAGE_ID]
  });
  const required = pkg[0];
  const exists = pkg[2];
  if (!exists || required === 0n) {
    throw new Error("Entry package (id=1) is not configured on Registration.");
  }

  let bal = await publicClient.readContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account]
  });
  if (bal < required) {
    try {
      const mintAmt = parseUnits("100", 18);
      const mintHash = await client.writeContract({
        address: params.usdt,
        abi: erc20Abi,
        functionName: "mint",
        args: [account, mintAmt],
        account,
        chain
      });
      await publicClient.waitForTransactionReceipt({
        hash: mintHash,
        pollingInterval: 2_000,
        confirmations: 1
      });
      bal = await publicClient.readContract({
        address: params.usdt,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account]
      });
    } catch {
      /* mainnet USDT */
    }
  }
  if (bal < required) {
    throw new Error("Insufficient USDT Balance");
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

    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
      pollingInterval: 2_000,
      confirmations: 1
    });
    if (approveReceipt.status !== "success") {
      throw new Error("USDT approve failed. Please try again.");
    }
  }

  const fn = registered ? "activate" : "registerAndActivate";
  const args = registered
    ? ([ENTRY_PACKAGE_ID] as const)
    : ([params.referrer, ENTRY_PACKAGE_ID] as const);

  try {
    await publicClient.simulateContract({
      account,
      address: registration,
      abi: registrationAbi,
      functionName: fn,
      args: args as never
    });
  } catch (simErr) {
    const msg = formatSubscribeSimulationError(simErr);
    if (/insufficient|transfer amount exceeds|ERC20/i.test(msg)) {
      throw new Error("Insufficient USDT Balance");
    }
    throw new Error(`Registration would fail: ${msg}`);
  }

  const gas = await gasOrFallback(
    publicClient,
    {
      account,
      address: registration,
      abi: registrationAbi,
      functionName: fn,
      args: args as never
    },
    2_500_000n
  );

  const hash = await client.writeContract({
    address: registration,
    abi: registrationAbi,
    functionName: fn,
    args: args as never,
    account,
    chain,
    gas
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 2_000,
    confirmations: 1
  });
  if (receipt.status !== "success") {
    throw new Error("Registration failed on-chain. Please try again.");
  }

  return hash;
}
