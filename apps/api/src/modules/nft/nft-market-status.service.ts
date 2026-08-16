import type { PrismaClient } from "@prisma/client";
import { type Address } from "viem";
import { env } from "../../shared/config/env.js";
import { mapWithConcurrency } from "../../shared/mapWithConcurrency.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { marketplaceAbi } from "../chain/marketplace-abi.js";
import { marketStatusFromChainReads, type NftMarketUiStatus } from "./nft-on-chain-hold.service.js";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const erc721ReadAbi = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }]
  }
] as const;

export type { NftMarketUiStatus } from "./nft-on-chain-hold.service.js";

/**
 * Ownership / listing for a token on NFTMarketplace (ERC-721 is the marketplace itself).
 * Hold = heldTokenId matches; for_sale = in queue / listed.
 */
export async function marketStatusForUsersToken(
  prisma: PrismaClient,
  userId: string,
  tokenId: string
): Promise<NftMarketUiStatus | null> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) return null;

  const burned = await prisma.nFTRecord.findFirst({
    where: { userId, tokenId, isBurned: true },
    select: { id: true }
  });
  if (burned) return "sold";

  const wallets = await prisma.walletConnection.findMany({
    where: { userId },
    select: { walletAddress: true }
  });
  const ownWallets = new Set(wallets.map((w) => w.walletAddress.trim().toLowerCase()));
  if (ownWallets.size === 0) return null;

  const client = getPublicClient();
  try {
    let erc721Owner: Address | null = null;
    try {
      erc721Owner = await client.readContract({
        address: mp,
        abi: erc721ReadAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)]
      });
    } catch {
      return "sold";
    }

    // Find which linked wallet (if any) currently holds this token.
    let holder: Address = ZERO;
    for (const w of ownWallets) {
      const held = await client.readContract({
        address: mp,
        abi: marketplaceAbi,
        functionName: "heldTokenId",
        args: [w as Address]
      });
      if (held === BigInt(tokenId)) {
        holder = w as Address;
        break;
      }
    }

    const isSale = holder === ZERO && erc721Owner?.toLowerCase() === mp.toLowerCase();
    const nftCurrOwner = holder !== ZERO ? holder : (erc721Owner ?? ZERO);
    const mappedOwner = holder !== ZERO ? holder : ZERO;

    const status = await marketStatusFromChainReads({
      tokenId,
      marketplaceAddress: mp,
      ownWallets,
      erc721Owner,
      isSale,
      nftCurrOwner,
      mappedOwner
    });
    if (status == null) {
      return "sold";
    }
    return status;
  } catch {
    return null;
  }
}

export async function marketStatusesForUsersTokens(
  prisma: PrismaClient,
  userId: string,
  tokenIds: string[]
): Promise<Map<string, NftMarketUiStatus | null>> {
  const out = new Map<string, NftMarketUiStatus | null>();
  const unique = [...new Set(tokenIds.map((t) => t.trim()).filter(Boolean))];
  await Promise.all(
    unique.map(async (tid) => {
      out.set(tid, await marketStatusForUsersToken(prisma, userId, tid));
    })
  );
  return out;
}

export type UserNftHoldSellCounts = {
  totalHold: number;
  totalInSell: number;
};

const ADMIN_NFT_STATUS_CONCURRENCY = 20;

/** Per-user hold vs listed counts for admin (on-chain status when marketplace is configured). */
export async function aggregateUserNftHoldAndSellCounts(
  prisma: PrismaClient
): Promise<Map<string, UserNftHoldSellCounts>> {
  const records = await prisma.nFTRecord.findMany({
    where: { isBurned: false },
    select: { userId: true, tokenId: true }
  });

  const counts = new Map<string, UserNftHoldSellCounts>();
  const bump = (userId: string) => {
    let row = counts.get(userId);
    if (!row) {
      row = { totalHold: 0, totalInSell: 0 };
      counts.set(userId, row);
    }
    return row;
  };

  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) {
    for (const rec of records) {
      bump(rec.userId).totalHold += 1;
    }
    return counts;
  }

  await mapWithConcurrency(records, ADMIN_NFT_STATUS_CONCURRENCY, async (rec) => {
    const status = await marketStatusForUsersToken(prisma, rec.userId, rec.tokenId);
    const row = bump(rec.userId);
    if (status === "for_sale") row.totalInSell += 1;
    else if (status === "hold") row.totalHold += 1;
  });

  return counts;
}
