import { formatEther, parseUnits, type Address } from "viem";
import { createPublicClientForChainId } from "./opbnb";
import { requestAdminGasSponsor } from "./requestAdminGasSponsor";

const MIN_NATIVE = parseUnits("0.00006", 18);

/**
 * TEMPORARY — if connected wallet is short on tBNB, ask server admin to drip gas (testnet only).
 */
export async function ensureWalletGas(params: {
  chainId: number;
  address: string;
}): Promise<{ tbnb: string; sponsored: boolean }> {
  const client = createPublicClientForChainId(params.chainId);
  const addr = params.address as Address;
  let nativeBal = await client.getBalance({ address: addr });

  if (nativeBal >= MIN_NATIVE) {
    return { tbnb: formatEther(nativeBal), sponsored: false };
  }

  const drip = await requestAdminGasSponsor(params.address);
  nativeBal = parseUnits(drip.nativeBalance, 18);
  if (nativeBal < MIN_NATIVE) {
    throw new Error(
      `Still not enough tBNB after admin gas (${drip.nativeBalance}). Try again in ~20s or use https://opbnb-testnet-faucet.bnbchain.org/`
    );
  }

  return { tbnb: drip.nativeBalance, sponsored: drip.sponsored };
}
