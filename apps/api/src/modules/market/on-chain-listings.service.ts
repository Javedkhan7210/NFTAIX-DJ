import { formatEther } from "viem";
import { env } from "../../shared/config/env.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { marketplaceAbi } from "../chain/marketplace-abi.js";

export type OnChainListingDto = {
  id: string;
  tokenNumber: number;
  name: string;
  tier: string;
  priceUsdt: string;
  imageUrl: string;
  listingKind: "on-chain";
  tokenId: string;
  seller: string | null;
  source: "fifo" | "mint";
  queuePosition: number;
};

/**
 * Full FIFO queue from NFTMarketplace (`queueAt`), plus primary mint ask when queue is empty.
 */
export async function getOnChainListings(opts?: { maxQueueScan?: number }): Promise<{
  listings: OnChainListingDto[];
  primaryMint: { priceUsdt: string } | null;
  sellFeePercent: string | null;
  queueLength: string;
}> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) {
    return { listings: [], primaryMint: null, sellFeePercent: null, queueLength: "0" };
  }

  const client = getPublicClient();
  const maxScan = Math.min(
    Math.max(20, opts?.maxQueueScan ?? env.MARKET_NFT_QUEUE_MAX_SCAN ?? 160),
    300
  );

  const [qLen, nextPrice, mintPrice] = await Promise.all([
    client.readContract({ address: mp, abi: marketplaceAbi, functionName: "queueLength" }),
    client.readContract({ address: mp, abi: marketplaceAbi, functionName: "nextListPrice" }),
    client.readContract({ address: mp, abi: marketplaceAbi, functionName: "mintPrice" })
  ]);

  const listings: OnChainListingDto[] = [];
  const scan = Math.min(Number(qLen), maxScan);

  for (let i = 0; i < scan; i++) {
    try {
      const entry = await client.readContract({
        address: mp,
        abi: marketplaceAbi,
        functionName: "queueAt",
        args: [BigInt(i)]
      });
      const tokenId = entry[0];
      const price = entry[1];
      const sellerRaw = entry[2];
      if (tokenId === 0n || price === 0n) continue;
      const seller =
        sellerRaw && sellerRaw !== "0x0000000000000000000000000000000000000000"
          ? sellerRaw
          : null;
      listings.push({
        id: `onchain-${tokenId.toString()}-${price.toString()}-${i}`,
        tokenNumber: Number(tokenId),
        name: `NFT #${tokenId.toString()}`,
        tier: "FIFO",
        priceUsdt: formatEther(price),
        imageUrl: "",
        listingKind: "on-chain",
        tokenId: tokenId.toString(),
        seller,
        source: "fifo",
        queuePosition: i
      });
    } catch {
      break;
    }
  }

  // Empty queue → show primary mint ask (buy() mints fresh)
  if (qLen === 0n) {
    const price = nextPrice > 0n ? nextPrice : mintPrice;
    if (price > 0n) {
      listings.push({
        id: `onchain-next-${price.toString()}`,
        tokenNumber: 0,
        name: "Next mint ask",
        tier: "FIFO",
        priceUsdt: formatEther(price),
        imageUrl: "",
        listingKind: "on-chain",
        tokenId: "next",
        seller: null,
        source: "mint",
        queuePosition: 0
      });
    }
  }

  return {
    listings,
    primaryMint: { priceUsdt: formatEther(nextPrice > 0n ? nextPrice : mintPrice) },
    sellFeePercent: null,
    queueLength: qLen.toString()
  };
}
