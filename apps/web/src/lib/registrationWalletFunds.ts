import { formatEther, formatUnits, parseAbi, parseUnits, type Address } from "viem";
import { createPublicClientForChainId, ensureNetworkForChainId } from "./opbnb";
import { ensureWalletGas } from "./ensureWalletGas";
import { getInjectedProvider } from "./wallet";

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const MIN_USDT = parseUnits("5", 18);

export type WalletFundsSnapshot = {
  address: string;
  usdt: string;
  tbnb: string;
  gasSponsored?: boolean;
};

/**
 * Read on-chain balances; if USDT ok but tBNB low, admin gas sponsor drips tBNB (testnet temp).
 */
export async function assertWalletReadyForRegistration(params: {
  chainId: number;
  address: string;
  usdt: Address;
  onGasSponsor?: () => void;
}): Promise<WalletFundsSnapshot> {
  const eth = getInjectedProvider();
  await ensureNetworkForChainId(eth as NonNullable<Window["ethereum"]>, params.chainId);

  const addr = params.address as Address;
  const client = createPublicClientForChainId(params.chainId);
  const usdtBal = await client.readContract({
    address: params.usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr]
  });

  const usdt = formatUnits(usdtBal, 18);

  if (usdtBal < MIN_USDT) {
    throw new Error(
      `Wrong wallet or no USDT. Connected: ${params.address} (${Number(usdt).toFixed(2)} USDT). ` +
        `In MetaMask import the test account 0x0623FeD6F6da9FCB04F9794d944c850c8fAB7Ba3 (200 USDT pre-funded).`
    );
  }

  const nativeBal = await client.getBalance({ address: addr });
  let tbnb = formatEther(nativeBal);
  let gasSponsored = false;

  if (nativeBal < parseUnits("0.00008", 18)) {
    params.onGasSponsor?.();
    const gas = await ensureWalletGas({ chainId: params.chainId, address: params.address });
    tbnb = gas.tbnb;
    gasSponsored = gas.sponsored;
  }

  return { address: params.address, usdt, tbnb, gasSponsored };
}
