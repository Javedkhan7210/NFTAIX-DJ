import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../shared/db/prisma.js";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";
import { getOnChainListings } from "./on-chain-listings.service.js";
import { requireAuth, requireFullAccess, type AuthRequest } from "../auth/auth.middleware.js";

export const marketRouter = Router();

async function dbCatalogListingDtos() {
  const rows = await prisma.marketNftListing.findMany({ orderBy: { sortOrder: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    tokenNumber: r.tokenNumber,
    name: r.name,
    tier: r.tier,
    priceUsdt: r.priceUsdt.toString(),
    imageUrl: `/market-nfts/${r.imageFile}`,
    listingKind: "catalog" as const
  }));
}

marketRouter.post("/primary-buy/relayed", requireAuth, requireFullAccess, async (_req: AuthRequest, res) => {
  return res.status(403).json({
    message:
      "Relayed primary mint is disabled. Buy on-chain with NFTMarketplace.buy() (wallet USDT approve)."
  });
});

const maxScanQuery = z.preprocess(
  (v) => (v === undefined || v === "" ? undefined : v),
  z.coerce.number().int().min(20).max(300).optional()
);

/**
 * Public listings: on-chain FIFO (`peekNext` / queue). Empty queue returns primary mint ask (`tokenId: "next"`).
 * Without marketplace env, falls back to DB catalog rows.
 */
marketRouter.get("/listings", async (req, res) => {
  const maxScan = maxScanQuery.parse(req.query.maxScan);

  const missingChainEnv: string[] = [];
  if (!env.MARKETPLACE_CONTRACT_ADDRESS) missingChainEnv.push("MARKETPLACE_CONTRACT_ADDRESS");

  if (missingChainEnv.length === 0) {
    try {
      const { listings: chainListings, primaryMint, sellFeePercent, queueLength } = await getOnChainListings({
        maxQueueScan: maxScan
      });
      return res.json({
        source: "on-chain" as const,
        listings: chainListings,
        primaryMint,
        sellFeePercent,
        queueLength,
        resaleOnly: false as const
      });
    } catch (err) {
      logger.warn({ err }, "on-chain market listings failed; falling back to catalog");
      const listings = await dbCatalogListingDtos();
      return res.json({
        source: "catalog" as const,
        listings,
        primaryMint: null,
        resaleOnly: false as const,
        catalogFallbackReason: "on-chain-read-failed" as const,
        catalogFallbackDetail: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const listings = await dbCatalogListingDtos();
  res.json({
    source: "catalog" as const,
    listings,
    primaryMint: null,
    resaleOnly: false as const,
    catalogFallbackReason: "missing-env" as const,
    missingChainEnv
  });
});
//old code