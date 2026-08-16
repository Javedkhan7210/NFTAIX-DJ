import { createPublicClient, defineChain, http } from "viem";
import { env } from "../../shared/config/env.js";

export const appChain = defineChain({
  id: env.CHAIN_ID,
  name: "nftdj",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
});

export function getPublicClient() {
  return createPublicClient({
    chain: appChain,
    transport: http(env.CHAIN_RPC_URL)
  });
}
