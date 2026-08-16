import type { PublicClient } from "viem";
import { env } from "../../shared/config/env.js";
import { marketplaceAbi } from "./marketplace-abi.js";

/** New stack: marketplace is NFTMarketplace (not a proxy). */
export async function resolveMarketplaceImplementation(
  _publicClient: PublicClient
): Promise<`0x${string}` | null> {
  return (env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined) ?? null;
}

/** True when marketplace exposes botBuy/runBot (new NFTMarketplace). */
export async function marketplaceSupportsBotBuy(publicClient: PublicClient): Promise<boolean> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) return false;
  try {
    await publicClient.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "nextListPrice"
    });
    return true;
  } catch {
    return false;
  }
}

export const BOT_BUY_UNAVAILABLE_MSG =
  "Bot buy unavailable: MARKETPLACE_CONTRACT_ADDRESS is not the new NFTMarketplace (missing botBuy/runBot).";
