import { api } from "../api/client";
import type { OnChainContextDto } from "./chainService";

export type NftQualifyDto = {
  nextTierActivationAmount: number;
  requiredDays: number;
  deadline: string;
  durationMet: boolean;
};

export type SubscriptionViewDto = {
  custodialUsdtBalance: string;
  /** When false, POST /packages/activate is off; use on-chain activate/upgrade only. */
  custodialActivationsEnabled: boolean;
  current: {
    id: string;
    name: string;
    activationAmount: string | number;
    tradingLimit: string | number;
    isBaseEntry: boolean;
    sortOrder: number;
  } | null;
  next: {
    id: string;
    name: string;
    activationAmount: string | number;
    tradingLimit: string | number;
    isBaseEntry: boolean;
    sortOrder: number;
  } | null;
  nftQualify: NftQualifyDto | null;
  currentActivation: {
    id: string;
    activatedAt: string;
    expiresAt: string | null;
    onChain: boolean;
    tierId: string;
  } | null;
};

export const packageService = {
  listTiers() {
    return api.get("/api/packages/tiers");
  },
  subscriptionView() {
    return api.get<SubscriptionViewDto>("/api/packages/subscription-view");
  },
  activate(tierId: string) {
    return api.post("/api/packages/activate", { tierId });
  },
  upgradeEligibility(toAmount: number) {
    return api.get(`/api/packages/upgrade-eligibility/${toAmount}`);
  },
  onChainContext() {
    return api.get<OnChainContextDto>("/api/packages/on-chain-context");
  },
  /** Backfill DB package row from Registration when indexer missed the activation event. */
  syncOnChainActivation() {
    return api.post<{
      synced: boolean;
      already?: boolean;
      reason?: string;
      activationId?: string;
      tierName?: string;
    }>("/api/packages/sync-on-chain-activation");
  }
};
