import { parseAbi, formatUnits, type Address } from "viem";
import { createConfiguredPublicClient, getConfiguredOpbnbChain } from "./opbnb";

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
]);

/** Live ERC-20 balance (human units) on the configured opBNB chain. */
export async function readWalletUsdtBalance(usdt: Address, wallet: Address, chainId: number): Promise<number> {
  const chain = getConfiguredOpbnbChain();
  if (chainId !== chain.id) {
    throw new Error(`readWalletUsdtBalance: expected chainId ${chain.id} but got ${chainId}`);
  }
  const client = createConfiguredPublicClient();
  const [raw, decimals] = await Promise.all([
    client.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    client.readContract({ address: usdt, abi: erc20Abi, functionName: "decimals" })
  ]);
  return parseFloat(formatUnits(raw, decimals));
}
