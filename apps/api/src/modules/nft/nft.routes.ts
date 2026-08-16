import { Router } from "express";
import { parseAbi, type Address } from "viem";
import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db/prisma.js";
import { env } from "../../shared/config/env.js";
import { mapWithConcurrency } from "../../shared/mapWithConcurrency.js";
import { paginatedFromQuery, parseListQuery } from "../../shared/pagination.js";
import { requireAuth, requireFullAccess, AuthRequest } from "../auth/auth.middleware.js";
import { syncUserPackageIncomeMetrics } from "../income/package-income-metrics.service.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { ChainIndexerService } from "../chain/chain-indexer.service.js";
function normalizeWallet(a: string): string {
  return a.trim().toLowerCase();
}

/** Same on-chain sale can appear twice (fromUserId set + wallet-only row); keep one per token+tx. */
function dedupeSoldOwnershipRows<
  T extends { tokenId: string; txHash: string; fromUserId: string | null; createdAt: Date }
>(rows: T[]): T[] {
  const bySale = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.tokenId}:${row.txHash.toLowerCase()}`;
    const prev = bySale.get(key);
    if (!prev) {
      bySale.set(key, row);
      continue;
    }
    const rowHasUser = Boolean(row.fromUserId);
    const prevHasUser = Boolean(prev.fromUserId);
    const rowAt = row.createdAt.getTime();
    const prevAt = prev.createdAt.getTime();
    const takeRow =
      (rowHasUser && !prevHasUser) || (rowHasUser === prevHasUser && rowAt > prevAt);
    if (takeRow) bySale.set(key, row);
  }
  return [...bySale.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

const chainIndexer = new ChainIndexerService(prisma);
export const nftRouter = Router();

/** Non-blocking indexer refresh for read endpoints (do not await on request path). */
function scheduleUserMarketDataSync(userId: string, force = false): void {
  void chainIndexer.ensureFreshUserMarketData(userId, force ? { force: true } : undefined).catch(() => {});
}
function listingFallbackImagePath(tokenId: string | number | bigint): string {
  const n = Number(tokenId);
  const slot = Number.isFinite(n) ? ((n - 1) % 10 + 10) % 10 + 1 : 1;
  return `/market-nfts/nft-${String(slot).padStart(2, "0")}.png`;
}

function weiToDecimal(wei: bigint): Prisma.Decimal {
  return new Prisma.Decimal(wei.toString()).div("1000000000000000000");
}

/** Latest acquisition USDT/time per token: trading log → ownership history → on-chain `baseValue` / `mintedAt`. */
async function attachPurchaseUsdt<
  T extends { tokenId: string; baseValue?: Prisma.Decimal | null; mintedAt?: Date }
>(
  userId: string,
  rows: T[]
): Promise<Array<T & { purchaseUsdt: string | null; purchaseTime: string | null }>> {
  const tokenIds = [...new Set(rows.map((r) => String(r.tokenId)))];
  if (tokenIds.length === 0) {
    return rows.map((r) => ({ ...r, purchaseUsdt: null, purchaseTime: null }));
  }
  const purchaseUsdtByToken = new Map<string, Prisma.Decimal>();
  const purchaseTimeByToken = new Map<string, Date>();
  const purchaseLogs = await prisma.tradingLog.findMany({
    where: { userId, relatedTokenId: { in: tokenIds } },
    orderBy: { tradeDate: "desc" },
    select: { relatedTokenId: true, volume: true, tradeDate: true }
  });
  for (const l of purchaseLogs) {
    const tid = l.relatedTokenId;
    if (!tid) continue;
    if (!purchaseUsdtByToken.has(tid)) purchaseUsdtByToken.set(tid, l.volume);
    if (!purchaseTimeByToken.has(tid)) purchaseTimeByToken.set(tid, l.tradeDate);
  }
  const stillMissingPrice = tokenIds.filter((tid) => !purchaseUsdtByToken.has(tid));
  const stillMissingTime = tokenIds.filter((tid) => !purchaseTimeByToken.has(tid));
  const needOwnership = [...new Set([...stillMissingPrice, ...stillMissingTime])];
  if (needOwnership.length > 0) {
    const ownership = await prisma.nftOwnershipHistory.findMany({
      where: { toUserId: userId, tokenId: { in: needOwnership } },
      orderBy: { createdAt: "desc" },
      select: { tokenId: true, priceUsdt: true, createdAt: true }
    });
    for (const o of ownership) {
      if (!purchaseUsdtByToken.has(o.tokenId)) {
        purchaseUsdtByToken.set(o.tokenId, o.priceUsdt);
      }
      if (!purchaseTimeByToken.has(o.tokenId)) {
        purchaseTimeByToken.set(o.tokenId, o.createdAt);
      }
    }
  }
  return rows.map((r) => {
    const tid = String(r.tokenId);
    const purchase = purchaseUsdtByToken.get(tid);
    const acquiredAt = purchaseTimeByToken.get(tid) ?? r.mintedAt ?? null;
    let purchaseUsdt: string | null = null;
    if (purchase != null) {
      purchaseUsdt = purchase.toString();
    } else {
      const bv = r.baseValue;
      if (bv != null && !new Prisma.Decimal(bv).isZero()) {
        purchaseUsdt = new Prisma.Decimal(bv).toString();
      }
    }
    return {
      ...r,
      purchaseUsdt,
      purchaseTime: acquiredAt ? acquiredAt.toISOString() : null
    };
  });
}

async function markNftRecordBurned(userId: string, tokenId: string): Promise<void> {
  await prisma.nFTRecord.updateMany({
    where: { userId, tokenId, isBurned: false },
    data: { isBurned: true, burnedAt: new Date() }
  });
  try {
    await syncUserPackageIncomeMetrics(prisma, userId);
  } catch {
    /* best-effort */
  }
}

nftRouter.get("/history", requireAuth, async (req: AuthRequest, res) => {
  const uid = req.user!.sub;
  scheduleUserMarketDataSync(uid);
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, {
    limit: 20,
    maxLimit: 50
  });
  const ownershipWhere = { OR: [{ toUserId: uid }, { fromUserId: uid }] };
  const [ownership, ownershipTotal, burns, splits] = await Promise.all([
    prisma.nftOwnershipHistory.findMany({
      where: ownershipWhere,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        tokenId: true,
        fromUserId: true,
        toUserId: true,
        fromWallet: true,
        toWallet: true,
        priceUsdt: true,
        kind: true,
        txHash: true,
        logIndex: true,
        createdAt: true
      }
    }),
    prisma.nftOwnershipHistory.count({ where: ownershipWhere }),
    prisma.nftBurnHistory.findMany({
      where: { buyerUserId: uid },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        tokenId: true,
        salePriceUsdt: true,
        txHash: true,
        logIndex: true,
        createdAt: true
      }
    }),
    prisma.nftSplitHistory.findMany({
      where: { buyerUserId: uid },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        parentTokenId: true,
        childTokenIds: true,
        txHash: true,
        createdAt: true
      }
    })
  ]);

  const dec = (d: Prisma.Decimal) => d.toString();
  type OwnRow = (typeof ownership)[number];
  type BurnRow = (typeof burns)[number];
  const ownershipItems = ownership.map((o: OwnRow) => ({
    id: o.id,
    tokenId: o.tokenId,
    fromWallet: o.fromWallet,
    toWallet: o.toWallet,
    priceUsdt: dec(o.priceUsdt),
    kind: o.kind,
    txHash: o.txHash,
    logIndex: o.logIndex,
    createdAt: o.createdAt,
    role: o.fromUserId === uid ? ("seller" as const) : o.toUserId === uid ? ("buyer" as const) : ("other" as const)
  }));
  res.json({
    ownership: paginatedFromQuery(ownershipItems, ownershipTotal, page, limit),
    burns: burns.map((b: BurnRow) => ({
      ...b,
      salePriceUsdt: dec(b.salePriceUsdt)
    })),
    splits
  });
});

/** Past on-chain resales where the current user was the seller (`fromUserId` or linked `fromWallet`). */
nftRouter.get("/sold", requireAuth, async (req: AuthRequest, res) => {
  const uid = req.user!.sub;
  const refresh =
    req.query.refresh === "1" || req.query.refresh === "true" || req.query.refresh === "yes";
  if (refresh) {
    scheduleUserMarketDataSync(uid, true);
  }
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, {
    limit: 20,
    maxLimit: 50
  });
  const linkedWallets = await prisma.walletConnection.findMany({
    where: { userId: uid },
    select: { walletAddress: true }
  });
  const walletAddrs = linkedWallets.map((w) => normalizeWallet(w.walletAddress));
  const soldWhere = {
    OR: [
      { fromUserId: uid },
      ...(walletAddrs.length > 0 ? [{ fromUserId: null, fromWallet: { in: walletAddrs } }] : [])
    ]
  };
  const fetchCap = Math.min(skip + limit + 60, 500);
  const rawRows = await prisma.nftOwnershipHistory.findMany({
    where: soldWhere,
    orderBy: { createdAt: "desc" },
    take: fetchCap,
    select: {
      id: true,
      tokenId: true,
      fromUserId: true,
      priceUsdt: true,
      kind: true,
      txHash: true,
      logIndex: true,
      createdAt: true,
      toWallet: true
    }
  });
  const deduped = dedupeSoldOwnershipRows(rawRows);
  const pageRows = deduped.slice(skip, skip + limit);
  const hasMore = deduped.length > skip + limit || rawRows.length >= fetchCap;
  const total = hasMore ? skip + limit + 1 : deduped.length;
  const payload = paginatedFromQuery(
    pageRows.map((r: (typeof pageRows)[number]) => ({
      id: r.id,
      tokenId: r.tokenId,
      priceUsdt: r.priceUsdt.toString(),
      kind: r.kind,
      txHash: r.txHash,
      logIndex: r.logIndex,
      createdAt: r.createdAt.toISOString(),
      toWallet: r.toWallet
    })),
    total,
    page,
    limit
  );
  res.json(payload);
});

nftRouter.post("/mint", requireAuth, requireFullAccess, async (_req: AuthRequest, res) => {
  return res.status(403).json({
    message:
      "Pay-and-mint (database NFT rows) is disabled. Use on-chain marketplace resales; the indexer updates ownership from Purchased events."
  });
});

nftRouter.get("/", requireAuth, async (req: AuthRequest, res) => {
  const uid = req.user!.sub;
  scheduleUserMarketDataSync(uid);
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, {
    limit: 20,
    maxLimit: 50
  });
  const nfts = await prisma.nFTRecord.findMany({
    where: { userId: uid, isBurned: false },
    orderBy: { mintedAt: "desc" }
  });
  const wallets = await prisma.walletConnection.findMany({
    where: { userId: uid },
    select: { walletAddress: true }
  });
  const ownWallets = new Set(wallets.map((w) => w.walletAddress.trim().toLowerCase()));
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) {
    const all = await attachPurchaseUsdt(
      uid,
      nfts.map((n) => ({ ...n, marketStatus: "hold" as const }))
    );
    return res.json(paginatedFromQuery(all.slice(skip, skip + limit), all.length, page, limit));
  }

  const client = getPublicClient();
  const heldAbi = parseAbi([
    "function heldTokenId(address user) view returns (uint256)",
    "function nextListPrice() view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function listed(uint256 tokenId) view returns (bool)",
    "function listPrice(uint256 tokenId) view returns (uint256)",
    "function queueLength() view returns (uint256)",
    "function queueAt(uint256 index) view returns (uint256 tokenId, uint256 price, address seller)",
    "function sellerOf(uint256 tokenId) view returns (address)"
  ]);

  /**
   * Portfolio after auto-list buy():
   * - rare holds via heldTokenId
   * - active FIFO listings where sellerOf / queueAt.seller is a linked wallet
   * - DB rows that still match ownerOf (wallet or marketplace listed)
   */
  const heldByWallet = new Map<string, string>();
  for (const w of wallets) {
    const addr = w.walletAddress.trim() as Address;
    if (!addr) continue;
    try {
      const held = await client.readContract({
        address: mp,
        abi: heldAbi,
        functionName: "heldTokenId",
        args: [addr]
      });
      if (held > 0n) heldByWallet.set(addr.toLowerCase(), held.toString());
    } catch {
      /* ignore */
    }
  }

  const nextPrice = await client
    .readContract({ address: mp, abi: heldAbi, functionName: "nextListPrice" })
    .catch(() => 0n);

  type PortfolioRow = {
    id: string;
    userId: string;
    tokenId: string;
    baseValue: Prisma.Decimal;
    currentValue?: Prisma.Decimal;
    isBurned: boolean;
    mintedAt: Date;
    burnedAt: Date | null;
    imageUrl: string;
    marketStatus: "hold" | "for_sale" | "sold";
  };

  const rows: PortfolioRow[] = [];
  const known = new Set<string>();

  for (const [wallet, tokenId] of heldByWallet) {
    known.add(tokenId);
    const db = nfts.find((n) => String(n.tokenId) === tokenId);
    rows.push({
      id: db?.id ?? `hold-${env.CHAIN_ID}-${tokenId}`,
      userId: uid,
      tokenId,
      baseValue: db?.baseValue ?? weiToDecimal(nextPrice),
      currentValue: weiToDecimal(nextPrice),
      isBurned: false,
      mintedAt: db?.mintedAt ?? new Date(),
      burnedAt: null,
      imageUrl: listingFallbackImagePath(tokenId),
      marketStatus: "hold"
    });
    void wallet;
  }

  // Scan FIFO queue for this user's auto-listed / listed NFTs (seller = buyer after buy).
  try {
    const qLen = await client.readContract({
      address: mp,
      abi: heldAbi,
      functionName: "queueLength"
    });
    const maxScan = Math.min(Number(qLen), Math.max(20, env.MARKET_NFT_QUEUE_MAX_SCAN || 160));
    for (let i = 0; i < maxScan; i++) {
      const entry = await client.readContract({
        address: mp,
        abi: heldAbi,
        functionName: "queueAt",
        args: [BigInt(i)]
      });
      const tokenId = entry[0].toString();
      const ask = entry[1];
      const seller = String(entry[2]).toLowerCase();
      if (!ownWallets.has(seller) || known.has(tokenId)) continue;
      known.add(tokenId);
      const db = nfts.find((n) => String(n.tokenId) === tokenId);
      rows.push({
        id: db?.id ?? `listed-${env.CHAIN_ID}-${tokenId}`,
        userId: uid,
        tokenId,
        baseValue: db?.baseValue ?? weiToDecimal(ask),
        currentValue: weiToDecimal(ask),
        isBurned: false,
        mintedAt: db?.mintedAt ?? new Date(),
        burnedAt: null,
        imageUrl: listingFallbackImagePath(tokenId),
        marketStatus: "for_sale"
      });
    }
  } catch {
    /* older marketplace without queueAt — fall through to DB ownerOf path */
  }

  for (const n of nfts) {
    const tid = String(n.tokenId);
    if (known.has(tid)) continue;
    try {
      const owner = await client.readContract({
        address: mp,
        abi: heldAbi,
        functionName: "ownerOf",
        args: [BigInt(tid)]
      });
      const ownerLc = String(owner).toLowerCase();
      if (!ownWallets.has(ownerLc) && ownerLc !== mp.toLowerCase()) {
        continue;
      }
      let listed = false;
      let ask = nextPrice;
      try {
        listed = await client.readContract({
          address: mp,
          abi: heldAbi,
          functionName: "listed",
          args: [BigInt(tid)]
        });
        if (listed) {
          ask = await client.readContract({
            address: mp,
            abi: heldAbi,
            functionName: "listPrice",
            args: [BigInt(tid)]
          });
        }
      } catch {
        listed = ownerLc === mp.toLowerCase();
      }
      // Only count marketplace escrow listings if this user is still the seller.
      if (listed && ownerLc === mp.toLowerCase()) {
        try {
          const seller = await client.readContract({
            address: mp,
            abi: heldAbi,
            functionName: "sellerOf",
            args: [BigInt(tid)]
          });
          if (!ownWallets.has(String(seller).toLowerCase())) continue;
        } catch {
          continue;
        }
      }
      const isHold = [...heldByWallet.values()].includes(tid);
      if (!isHold && !listed && !ownWallets.has(ownerLc)) continue;
      known.add(tid);
      rows.push({
        id: n.id,
        userId: uid,
        tokenId: tid,
        baseValue: n.baseValue,
        currentValue: weiToDecimal(ask > 0n ? ask : nextPrice),
        isBurned: false,
        mintedAt: n.mintedAt,
        burnedAt: null,
        imageUrl: listingFallbackImagePath(tid),
        marketStatus: isHold ? "hold" : listed ? "for_sale" : "hold"
      });
    } catch {
      /* burned / missing */
    }
  }

  const enriched = await attachPurchaseUsdt(uid, rows);
  const sorted = [...enriched].sort((a, b) => {
    const at = new Date(a.purchaseTime ?? a.mintedAt).getTime();
    const bt = new Date(b.purchaseTime ?? b.mintedAt).getTime();
    return bt - at;
  });
  const pageItems = sorted.slice(skip, skip + limit);
  res.json(paginatedFromQuery(pageItems, sorted.length, page, limit));
});
