import { api } from "../api/client";

export type BlockchainActivityDto = {
  registrationTxHash: string | null;
  subscriptions: Array<{
    id: string;
    activatedAt: string;
    onChain: boolean;
    /** Newer API field name. */
    chainTxHash?: string | null;
    /** Back-compat for older deployments. */
    txHash?: string | null;
    tierName: string;
    tierAmount: string | number;
  }>;
  /** Indexed marketplace buy rows for this user’s linked wallets (after chain indexer runs). */
  nftPurchases: Array<{
    txHash: string;
    tokenId: string;
    priceUsdt: string | null;
    blockNumber: string;
  }>;
};

export type NftTradeStatsDto = {
  nftPurchaseCount: number;
  nftSaleCount: number;
};

export const userService = {
  profile() {
    return api.get("/api/user/profile");
  },
  blockchainActivity() {
    return api.get<BlockchainActivityDto>("/api/user/blockchain-activity");
  },
  team() {
    return api.get("/api/user/team");
  },
  referrals() {
    return api.get("/api/user/referrals");
  },
  globalTeam() {
    return api.get("/api/user/global-team");
  },

  nftTradeStats() {
    return api.get<NftTradeStatsDto>("/api/user/nft-trade-stats");
  }
};
