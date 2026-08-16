import { api } from "../api/client";

export type MarketListingDto = {
  id: string;
  tokenNumber: number;
  /** On-chain FIFO queue token id (informational; `buy()` takes next in queue). */
  tokenId?: string;
  name: string;
  tier: string;
  priceUsdt: string;
  imageUrl: string;
  /** `on-chain` = NFTMarketplace FIFO queue (current stack); `secondary` = legacy alias. */
  listingKind?: "secondary" | "catalog" | "on-chain";
  /** Secondary: contract base price before fee (USDT string). */
  listingBaseUsdt?: string;
  /** Secondary: mint/first `nftBuyTimeStamp` (unix sec). */
  firstBuyTime?: number;
  /** Secondary: last completed sale (`nftSaleTimeStamp`, unix sec). */
  lastSaleTime?: number;
  /** On-chain FIFO queue index (0 = first to sell). */
  queuePosition?: number;
  /** From listings API when on-chain. */
  source?: "fifo" | "mint";
  /** On-chain seller (`nftCurrOwner`) — do not show Buy when this matches the connected wallet. */
  saleOwner?: string;
  /** Alias from API `seller` field for FIFO listings. */
  seller?: string | null;
};

export type PrimaryMintDto = {
  priceUsdt: string;
  totalMinted?: string;
  maxSupply?: string;
  soldOut?: boolean;
};

export type MarketListingsResponse = {
  source: "on-chain" | "catalog";
  listings: MarketListingDto[];
  primaryMint: PrimaryMintDto | null;
  /** On-chain FIFO depth. */
  queueLength?: string;
  /** When true, API returns on-chain resale queue only (no primary mint card). */
  resaleOnly?: boolean;
  /** When `source` is on-chain: marketplace `sellPercent` (e.g. 10 = 10%). */
  sellFeePercent?: number;
  /** Why the API fell back to DB catalog (on-chain mode not active). */
  catalogFallbackReason?: "missing-env" | "on-chain-read-failed";
  missingChainEnv?: string[];
  catalogFallbackDetail?: string;
};

/** Response from `POST /api/market/primary-buy/relayed` (keeper FIFO `buy`). */
export type RelayedPrimaryBuyResponse = {
  txHash: `0x${string}`;
  buyer: `0x${string}`;
  note: string;
};

export const marketService = {
  listings(params?: { maxScan?: number }) {
    return api.get<MarketListingsResponse>("/api/market/listings", {
      params: params?.maxScan != null ? { maxScan: params.maxScan } : undefined
    });
  },

  relayedPrimaryBuy(walletAddress: `0x${string}`, enableTxHash?: `0x${string}`) {
    return api.post<RelayedPrimaryBuyResponse>("/api/market/primary-buy/relayed", {
      walletAddress: walletAddress.toLowerCase(),
      ...(enableTxHash ? { enableTxHash } : {})
    });
  }
};
