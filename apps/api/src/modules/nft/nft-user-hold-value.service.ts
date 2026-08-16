import { Prisma, type PrismaClient } from "@prisma/client";
import { formatEther, type Address } from "viem";
import { env } from "../../shared/config/env.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { marketplaceAbi } from "../chain/marketplace-abi.js";
import { marketStatusFromChainReads } from "./nft-on-chain-hold.service.js";

const erc721ReadAbi = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }]
  }
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function weiToDecimal(wei: bigint): Prisma.Decimal {
  return new Prisma.Decimal(formatEther(wei));
}

/**
 * Held NFT USDT value using NFTMarketplace.heldTokenId.
 * Prefers latest TradingLog.volume for the token; else nextListPrice / DB currentValue.
 */
export async function sumUserNftHoldListPriceUsdt(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string
): Promise<Prisma.Decimal> {
  const nfts = await prisma.nFTRecord.findMany({
    where: { userId, isBurned: false },
    orderBy: { mintedAt: "desc" }
  });
  const wallets = await prisma.walletConnection.findMany({
    where: { userId },
    select: { walletAddress: true }
  });
  const ownWallets = new Set(wallets.map((w) => w.walletAddress.trim().toLowerCase()));

  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) {
    const listById = new Map<string, Prisma.Decimal>();
    for (const n of nfts) listById.set(String(n.tokenId), new Prisma.Decimal(n.currentValue));
    const tokenIds = [...listById.keys()];
    const purchaseByTokenId = new Map<string, Prisma.Decimal>();
    if (tokenIds.length > 0) {
      const purchaseLogs = await prisma.tradingLog.findMany({
        where: { userId, relatedTokenId: { in: tokenIds } },
        orderBy: { tradeDate: "desc" },
        select: { relatedTokenId: true, volume: true }
      });
      for (const l of purchaseLogs) {
        const tid = l.relatedTokenId;
        if (!tid || purchaseByTokenId.has(tid)) continue;
        purchaseByTokenId.set(tid, l.volume);
      }
    }
    let sum = new Prisma.Decimal(0);
    for (const [tid, cur] of listById) {
      sum = sum.plus(purchaseByTokenId.get(tid) ?? cur);
    }
    return sum;
  }

  const client = getPublicClient();
  let nextListPrice = 0n;
  try {
    nextListPrice = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "nextListPrice"
    });
  } catch {
    nextListPrice = 0n;
  }

  const listPriceByTokenId = new Map<string, Prisma.Decimal>();

  const withStatus = await Promise.all(
    nfts.map(async (n) => {
      try {
        let erc721Owner: Address | null = null;
        try {
          erc721Owner = await client.readContract({
            address: mp,
            abi: erc721ReadAbi,
            functionName: "ownerOf",
            args: [BigInt(n.tokenId)]
          });
        } catch {
          return null;
        }

        let holder: Address = ZERO;
        for (const w of ownWallets) {
          const held = await client.readContract({
            address: mp,
            abi: marketplaceAbi,
            functionName: "heldTokenId",
            args: [w as Address]
          });
          if (held === BigInt(n.tokenId)) {
            holder = w as Address;
            break;
          }
        }

        const isSale = holder === ZERO && erc721Owner?.toLowerCase() === mp.toLowerCase();
        const nftCurrOwner = holder !== ZERO ? holder : (erc721Owner ?? ZERO);
        const mappedOwner = holder !== ZERO ? holder : ZERO;

        if (ownWallets.size > 0) {
          const inUserWallet = erc721Owner && ownWallets.has(String(erc721Owner).toLowerCase());
          const escrowListed =
            erc721Owner &&
            String(erc721Owner).toLowerCase() === mp.toLowerCase() &&
            isSale &&
            ownWallets.has(String(nftCurrOwner).toLowerCase());
          const legacyMapped = ownWallets.has(String(mappedOwner).toLowerCase());
          if (!inUserWallet && !escrowListed && !legacyMapped && holder === ZERO) {
            return null;
          }
        }

        const currentWei = nextListPrice > 0n ? nextListPrice : 0n;
        const marketStatus = await marketStatusFromChainReads({
          tokenId: String(n.tokenId),
          marketplaceAddress: mp,
          ownWallets,
          erc721Owner,
          isSale,
          nftCurrOwner,
          mappedOwner
        });
        if (marketStatus !== "hold") {
          return null;
        }
        const listPrice =
          currentWei > 0n ? weiToDecimal(currentWei) : new Prisma.Decimal(n.currentValue);
        return { tokenId: String(n.tokenId), listPrice };
      } catch {
        return { tokenId: String(n.tokenId), listPrice: new Prisma.Decimal(n.currentValue) };
      }
    })
  );

  for (const row of withStatus) {
    if (row != null) listPriceByTokenId.set(row.tokenId, row.listPrice);
  }

  const tokenIds = [...listPriceByTokenId.keys()];
  const purchaseByTokenId = new Map<string, Prisma.Decimal>();
  if (tokenIds.length > 0) {
    const purchaseLogs = await prisma.tradingLog.findMany({
      where: { userId, relatedTokenId: { in: tokenIds } },
      orderBy: { tradeDate: "desc" },
      select: { relatedTokenId: true, volume: true }
    });
    for (const l of purchaseLogs) {
      const tid = l.relatedTokenId;
      if (!tid || purchaseByTokenId.has(tid)) continue;
      purchaseByTokenId.set(tid, l.volume);
    }
  }

  let sum = new Prisma.Decimal(0);
  for (const [tid, listP] of listPriceByTokenId) {
    const purchase = purchaseByTokenId.get(tid);
    sum = sum.plus(purchase ?? listP);
  }
  return sum;
}
