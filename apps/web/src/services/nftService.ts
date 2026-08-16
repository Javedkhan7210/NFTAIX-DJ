import { api } from "../api/client";
import { coercePaginated, type Paginated } from "../lib/pagination";

export type NftListParams = { page?: number; limit?: number };
export type NftSoldParams = NftListParams & { refresh?: boolean };
export type NftHistoryParams = NftListParams;

export type NftPortfolioItem = {
  id: string;
  tokenId: string;
  baseValue?: unknown;
  currentValue?: unknown;
  isBurned?: boolean;
  mintedAt?: string;
  burnedAt?: string | null;
  imageUrl?: string;
  marketStatus?: string;
  purchaseUsdt?: string | number | null;
  /** When the user bought this token (trading log / ownership history), not NFTRecord.mintedAt. */
  purchaseTime?: string | null;
};

export type NftSoldItem = {
  id: string;
  tokenId: string;
  priceUsdt: string;
  kind: string;
  txHash: string;
  logIndex: number;
  createdAt: string;
  toWallet: string;
};

export type NftHistoryOwnership = {
  id: string;
  tokenId: string;
  fromWallet: string;
  toWallet: string;
  priceUsdt: string;
  kind: string;
  txHash: string;
  logIndex: number;
  createdAt: string;
  role: "seller" | "buyer" | "other";
};

export type NftHistoryResponse = {
  ownership: Paginated<NftHistoryOwnership>;
  burns: Array<{
    id: string;
    tokenId: string;
    salePriceUsdt: string;
    txHash: string;
    logIndex: number;
    createdAt: string;
  }>;
  splits: Array<{
    id: string;
    parentTokenId: string;
    childTokenIds: unknown;
    txHash: string;
    createdAt: string;
  }>;
};

const DEFAULT_PAGE_SIZE = 20;

export const nftService = {
  list(params?: NftListParams) {
    const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
    return api
      .get<Paginated<NftPortfolioItem> | NftPortfolioItem[]>("/api/nfts", { params })
      .then((res) => ({ ...res, data: coercePaginated<NftPortfolioItem>(res.data, limit) }));
  },
  history(params?: NftHistoryParams) {
    const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
    return api.get<NftHistoryResponse>("/api/nfts/history", { params }).then((res) => {
      const ownership = res.data?.ownership;
      const ownershipPaginated = Array.isArray(ownership)
        ? coercePaginated<NftHistoryOwnership>(ownership, limit)
        : coercePaginated<NftHistoryOwnership>(ownership, limit);
      return {
        ...res,
        data: {
          ...res.data,
          ownership: ownershipPaginated
        }
      };
    });
  },
  sold(params?: NftSoldParams) {
    const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
    return api
      .get<Paginated<NftSoldItem> | NftSoldItem[]>("/api/nfts/sold", {
        params: {
          page: params?.page,
          limit: params?.limit,
          ...(params?.refresh ? { refresh: "1" } : {})
        }
      })
      .then((res) => ({ ...res, data: coercePaginated<NftSoldItem>(res.data, limit) }));
  }
};
