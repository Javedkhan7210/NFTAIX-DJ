import { api } from "../api/client";

export type ChainStatusDto = {
  configured: boolean;
  onChainUiReady: boolean;
  missingOnChainConfig: string[];
  rpcOk: boolean;
  chainId: number;
  latestBlock?: string;
  lastSyncedBlock?: string;
  usdt?: string;
  /** Registration contract. */
  registration?: string;
  marketplace?: string;
  rewards?: string;
  globalPool?: string;
  treasury?: string;
  liquidityManager?: string;
  creator?: string;
};

/** Resolve Registration address from chain status. */
export function registrationAddressFromStatus(
  status: Pick<ChainStatusDto, "registration">
): string | undefined {
  const reg = status.registration?.trim();
  return reg || undefined;
}

export type OnChainContextDto = {
  sponsorWallet: string;
  /** Registration root / default sponsor when user sponsor is unset */
  defaultReferrerWallet: string;
};

export type ActivationLookupDto = {
  activation: unknown;
  events: unknown[];
};

export const chainService = {
  status() {
    return api.get<ChainStatusDto>("/api/chain/status");
  },
  /** Index recent marketplace blocks so trading/NFT history updates without waiting for catch-up. */
  syncRecent(txHash?: string) {
    return api.post<{
      ok: boolean;
      txSync?: { processed: number };
      processed: number;
      fromBlock: string;
      toBlock: string;
      latestBlock: string;
      gapBlocks: string;
    }>("/api/chain/sync-recent", txHash ? { txHash } : {});
  },
  activation(txHash: string) {
    return api.get<ActivationLookupDto>(`/api/chain/activation/${txHash}`);
  }
};
