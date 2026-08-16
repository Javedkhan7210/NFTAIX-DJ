import { formatEther, parseAbi, parseUnits, type Address } from "viem";
import { api } from "../api/client";
import { createPublicClientForChainId, ensureNetworkForChainId } from "./opbnb";
import { getInjectedProvider, requestWalletAddress } from "./wallet";

export type TestnetFaucetResult = {
  ok: true;
  chainId: number;
  address: string;
  gasTxHash: string | null;
  mintTxHash: string | null;
  nativeBalance: string;
  usdtBalanceHint: string;
};

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const MIN_NATIVE = parseUnits("0.0001", 18);
const MIN_USDT = parseUnits("5", 18);

/**
 * Server-side testnet faucet: drips tBNB for gas + mints MockUSDT.
 * Pass `address` when already known so Trust/MetaMask cannot fund a different account.
 */
export async function claimTestnetFaucet(params?: {
  chainId?: number;
  address?: string;
}): Promise<TestnetFaucetResult> {
  const eth = getInjectedProvider();
  if (params?.chainId) {
    await ensureNetworkForChainId(eth as NonNullable<Window["ethereum"]>, params.chainId);
  }
  const address = (params?.address ?? (await requestWalletAddress())).trim();
  const { data } = await api.post<TestnetFaucetResult>("/api/public/testnet-faucet", { address });
  if (Number(data.nativeBalance) < 0.0001) {
    throw new Error(
      `Faucet returned too little tBNB (${data.nativeBalance}). Add opBNB testnet tBNB to ${data.address}, then retry.`
    );
  }
  return data;
}

/** Skip server faucet when USDT is enough; only call API when USDT is also missing. */
export async function ensureTestnetRegistrationFunds(params: {
  chainId: number;
  address: string;
  usdt: Address;
}): Promise<TestnetFaucetResult> {
  const publicClient = createPublicClientForChainId(params.chainId);
  const addr = params.address as Address;
  const [nativeBal, usdtBal] = await Promise.all([
    publicClient.getBalance({ address: addr }),
    publicClient.readContract({
      address: params.usdt,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr]
    })
  ]);

  const native = formatEther(nativeBal);
  const usdt = formatEther(usdtBal);

  if (usdtBal >= MIN_USDT && nativeBal >= MIN_NATIVE) {
    return {
      ok: true,
      chainId: params.chainId,
      address: params.address,
      gasTxHash: null,
      mintTxHash: null,
      nativeBalance: native,
      usdtBalanceHint: usdt
    };
  }

  if (usdtBal >= MIN_USDT && nativeBal < MIN_NATIVE) {
    return claimTestnetFaucet({ chainId: params.chainId, address: params.address });
  }

  return claimTestnetFaucet({ chainId: params.chainId, address: params.address });
}
