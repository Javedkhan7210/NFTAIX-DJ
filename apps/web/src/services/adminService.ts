import { api } from "../api/client";
import type { DashboardContentPayload } from "./publicContentService";

export type BotPurchaseRunSummaryDto = {
  id: string;
  status: string;
  trigger: string;
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  summary: unknown;
  attemptCount: number;
};

export type BotPurchaseAttemptDto = {
  id: string;
  sortOrder: number;
  userId: string;
  publicUserNumber: number;
  email: string | null;
  walletAddress: string | null;
  targetRemainingUsdt: number;
  balanceUsdt: number;
  budgetUsdt: number;
  tokenId: string | null;
  effectivePayUsdt: number | null;
  status: string;
  failureReason: string | null;
  chainTxHash: string | null;
  createdAt: string;
};

export type BotPurchaseRunDetailDto = {
  id: string;
  status: string;
  trigger: string;
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  summary: unknown;
  attempts: BotPurchaseAttemptDto[];
};

export const adminService = {
  stats() {
    return api.get<{
      totalUsers: number;
      blockedUsers: number;
      rewardSettings: number;
      nftRecords: number;
      recentAdminActions: number;
      activeAutoTradeBots: number;
    }>("/api/admin/stats");
  },
  dashboardContent() {
    return api.get<{ payload: DashboardContentPayload; updatedAt: string | null }>("/api/admin/dashboard-content");
  },
  patchDashboardContent(payload: DashboardContentPayload) {
    return api.patch<{ payload: DashboardContentPayload; updatedAt: string }>("/api/admin/dashboard-content", { payload });
  },
  uploadDashboardAsset(filename: string, dataUrl: string) {
    return api.post<{ url: string }>("/api/admin/dashboard-assets", { filename, dataUrl });
  },
  users(params?: { q?: string; take?: number }) {
    return api.get<unknown[]>("/api/admin/users", { params });
  },
  usersSearch(params?: { q?: string; take?: number; skip?: number }) {
    return api.get<{ rows: unknown[]; total: number; skip: number; take: number }>("/api/admin/users/search", { params });
  },
  patchUserStatus(
    id: string,
    body: { isActive?: boolean; blockedReason?: string | null; clearBlockedReason?: boolean }
  ) {
    return api.patch(`/api/admin/users/${id}/status`, body);
  },
  blockWallet(userId: string, walletId: string, blocked: boolean) {
    return api.post(`/api/admin/users/${userId}/wallets/${walletId}/block`, { blocked });
  },
  rewireSponsor(userId: string, sponsorUserId: string | null) {
    return api.post<{ ok: boolean }>(`/api/admin/users/${userId}/sponsor`, { sponsorUserId });
  },
  grantPackage(
    userId: string,
    body: { tierId: string; runIncomeDistribution?: boolean; reason?: string }
  ) {
    return api.post(`/api/admin/users/${userId}/package`, body);
  },
  /** Free on-chain register+activate (no USDT). Superadmin + authorizer key. */
  freeRegisterActivate(body: { userWallet: string; sponsorWallet: string; packageId?: number }) {
    return api.post<{ txHash: string; packageId: number }>("/api/admin/chain/free-register-activate", body);
  },
  /** Free on-chain package upgrade (no USDT). */
  freeUpgrade(body: { userWallet: string; packageId: number }) {
    return api.post<{ txHash: string; packageId: number }>("/api/admin/chain/free-upgrade", body);
  },
  setUserAutoTradeBot(userId: string, enabled: boolean) {
    return api.patch<{ enabled: boolean }>(`/api/admin/users/${userId}/auto-trade-bot`, { enabled });
  },
  triggerUserManualTrade(userId: string) {
    return api.post<{
      runId: string;
      status: string;
      successes: number;
      failures: number;
      skipped: number;
      purchasesAttempted: number;
      failureReason: string | null;
      lastChainTxHash: string | null;
      lastTokenId: string | null;
    }>(`/api/admin/users/${userId}/trade-now`);
  },
  resetUserTradingLimit(userId: string) {
    return api.post<{
      packageActivationId: string;
      deletedLogs: number;
      deletedCompliance: number;
      previousPackageVolume: number;
      previousTodayVolume: number;
      packageTradingLimit: number;
      dailyAllowance: number;
    }>(`/api/admin/users/${userId}/reset-trading-limit`);
  },
  recountReferrals() {
    return api.post<{ usersUpdated: number }>("/api/admin/maintenance/recount-referrals");
  },
  rewardSettings() {
    return api.get<Array<{ id: string; key: string; value: string }>>("/api/admin/reward-settings");
  },
  patchRewardSetting(key: string, value: string) {
    return api.patch(`/api/admin/reward-settings/${encodeURIComponent(key)}`, { value });
  },
  bulkSettings(settings: Array<{ key: string; value: string }>) {
    return api.patch("/api/admin/settings", { settings });
  },
  packageTiers() {
    return api.get<unknown[]>("/api/admin/package-tiers");
  },
  createPackageTier(body: Record<string, unknown>) {
    return api.post("/api/admin/package-tiers", body);
  },
  patchPackageTier(id: string, body: Record<string, unknown>) {
    return api.patch(`/api/admin/package-tiers/${id}`, body);
  },
  nftActivity(params?: { userId?: string; limit?: number }) {
    return api.get<{ nftRecords: unknown[]; chainBuyEvents: unknown[] }>("/api/admin/nft-activity", { params });
  },
  nftActivitySearch(params?: { userId?: string; take?: number; skip?: number }) {
    return api.get<{
      nft: { rows: unknown[]; total: number; skip: number; take: number };
      chainBuyEvents: { rows: unknown[]; total: number; skip: number; take: number };
    }>("/api/admin/nft-activity/search", { params });
  },
  marketListings() {
    return api.get<unknown[]>("/api/admin/market-listings");
  },
  createMarketListing(body: Record<string, unknown>) {
    return api.post("/api/admin/market-listings", body);
  },
  nftOnChainMintDefaults() {
    return api.get<{
      defaultRecipient: string;
      marketplaceOwner: string;
      paidMintWallet: string;
      marketplace?: string;
      mode?: string;
      message?: string;
    }>("/api/admin/nft/on-chain-mint/defaults");
  },
  nftOnChainMintPreflight(recipient?: string) {
    return api.get<{ ready: boolean; issues: string[] }>("/api/admin/nft/on-chain-mint/preflight", {
      params: recipient?.trim() ? { recipient: recipient.trim() } : {}
    });
  },
  nftOnChainMintQuote(quantity: number) {
    return api.get<{
      unitPriceWei: string;
      unitPriceUsdt: string;
      totalWei: string;
      totalUsdt: string;
      minted: string;
      maxSupply: string;
      remaining: string;
      queueLength?: string;
      burnThresholdUsdt?: string;
    }>("/api/admin/nft/on-chain-mint/quote", { params: { quantity } });
  },
  nftOnChainMint(body: { recipient?: string; quantity: number; label?: string }) {
    return api.post<{
      mintTxHashes: string[];
      transferTxHash: string | null;
      tokenIds: string[];
      listedOnMarket?: boolean;
    }>("/api/admin/nft/on-chain-mint", body);
  },
  /** Owner `adminMintToQueue` — seeds public FIFO. Admin or superadmin. */
  nftAdminMintPrimaryFree(body: { recipient?: string; quantity: number; label?: string }) {
    return api.post<{
      mintTxHash: string;
      transferTxHash: string | null;
      tokenIds: string[];
      listedOnMarket?: boolean;
      recipient?: string;
    }>("/api/admin/nft/admin-mint-primary-free", body);
  },
  /** Preview burn-buy: seller address + USDT the marketplace owner wallet must pay (listed resale only). */
  nftOnChainBurnListedQuote(tokenId: string) {
    return api.get<{
      tokenId: string;
      seller: string;
      isSale: boolean;
      listBasePriceWei: string;
      payWei: string;
      payUsdt: string;
    }>("/api/admin/nft/on-chain-burn-listed/quote", { params: { tokenId } });
  },
  /** Owner key (`MARKETPLACE_OWNER_PRIVATE_KEY`): `burnNftFromOwner` — pays seller USDT, burns NFT per contract. */
  nftOnChainBurnListed(body: { tokenId: string | number }) {
    return api.post<{ txHash: string }>("/api/admin/nft/on-chain-burn-listed", body);
  },
  /** Preview force-burn: current ERC721 owner + whether marketplace still shows a listing. */
  nftOnChainForceBurnQuote(tokenId: string) {
    return api.get<{
      tokenId: string;
      erc721Owner: string;
      marketplaceAddress: string;
      heldByMarketplace: boolean;
      isListedForSale: boolean;
      listingSeller: string | null;
      warning: string | null;
    }>("/api/admin/nft/on-chain-force-burn/quote", { params: { tokenId } });
  },
  /** Owner `burnNftId` — burn any minted token (wallet or escrow); no USDT to seller. */
  nftOnChainForceBurn(body: { tokenId: string | number }) {
    return api.post<{ txHash: string }>("/api/admin/nft/on-chain-force-burn", body);
  },
  patchMarketListing(id: string, body: Record<string, unknown>) {
    return api.patch(`/api/admin/market-listings/${id}`, body);
  },
  deleteMarketListing(id: string) {
    return api.delete(`/api/admin/market-listings/${id}`);
  },
  chainEvents(params?: { eventName?: string; txHash?: string; limit?: number }) {
    return api.get<unknown[]>("/api/admin/chain-events", { params });
  },
  contractsEnv() {
    return api.get<{
      chainId: number;
      rpcUrlHost: string;
      registration?: string | null;
      marketplace: string | null;
      usdt: string | null;
      rewards?: string | null;
      globalPool?: string | null;
      treasury?: string | null;
      liquidityManager?: string | null;
    }>("/api/admin/contracts-env");
  },
  networksOverview() {
    return api.get<{
      activeChainId: number;
      networks: Array<{
        key: "testnet" | "mainnet";
        chainId: number;
        name: string;
        rpcUrl: string;
        explorerUrl: string;
        deploymentFile: string;
        isActive: boolean;
        liveRpcHost: string | null;
        contracts: Record<string, string | null>;
        liveContracts: Record<string, string | null> | null;
        apiEnvExample: string[];
        webEnvExample: string[];
        balances: {
          /** USDT ERC-20 address used for balance reads (when API provides it) */
          usdt?: string | null;
          /** USDT address from networks-overview (legacy key name) */
          usdtToken: string | null;
          rows: Array<{
            target: string;
            label: string;
            contractAddress: string | null;
            balanceFormatted: string | null;
            error?: string;
          }>;
        };
      }>;
    }>("/api/admin/networks-overview");
  },
  contractUsdtBalances() {
    return api.get<{
      usdt: string | null;
      /** @deprecated alias — same as `usdt` */
      usdtToken: string | null;
      decimals: number;
      dedicatedRecoverKey: boolean;
      rows: Array<{
        target: string;
        contractAddress: string | null;
        balanceWei: string | null;
        balanceFormatted: string | null;
        error?: string;
      }>;
    }>("/api/admin/contracts/usdt-balances");
  },
  recoverContractUsdt(body: { target: string; amount: "all" | string }) {
    return api.post<{ txHash: string }>("/api/admin/contracts/recover-usdt", body);
  },
  chainSync() {
    return api.post<unknown>("/api/admin/chain/sync");
  },
  backfillOnChainActivationRewards(body?: { limit?: number }) {
    return api.post<{ processed: number; candidates: number; errors: string[] }>(
      "/api/admin/rewards/backfill-on-chain-activations",
      body ?? {}
    );
  },
  /** @deprecated Legacy owner activate path — prefer on-chain Registration activate/upgrade. */
  registrationActivateOwner(body: {
    userAddresses: string[];
    referrerAddresses: string[];
    level: number;
    isBlockBool?: boolean;
  }) {
    return api.post<{ txHash: string }>("/api/admin/registration/subscribe-owner", body);
  },
  /** @deprecated use registrationActivateOwner */
  registrationSubscribeOwner(body: {
    userAddresses: string[];
    referrerAddresses: string[];
    level: number;
    isBlockBool?: boolean;
  }) {
    return this.registrationActivateOwner(body);
  },
  adminLogs(take?: number) {
    return api.get<unknown[]>("/api/admin/admin-logs", { params: { take } });
  },
  income() {
    return api.get<unknown[]>("/api/admin/income");
  },
  airdropPreview(body: Record<string, unknown>) {
    return api.post<unknown>("/api/admin/airdrop/preview", body);
  },
  airdropExecute(body: { confirm: true; request: Record<string, unknown> }) {
    return api.post<{ runId: string; txHashes: string[] }>("/api/admin/airdrop/execute", body);
  },
  botPurchaseRuns(take?: number) {
    return api.get<BotPurchaseRunSummaryDto[]>("/api/admin/bot-purchase-runs", { params: { take } });
  },
  botPurchaseRun(id: string) {
    return api.get<BotPurchaseRunDetailDto>(`/api/admin/bot-purchase-runs/${id}`);
  },
  triggerBotPurchaseRun() {
    return api.post<{
      runId: string;
      status: string;
      usersProcessed: number;
      successes: number;
      failures: number;
      skipped: number;
    }>("/api/admin/bot-purchase-runs/trigger");
  },
  resetAllDailyLimitsAndRunBot() {
    return api.post<{
      globalDailyVolumeSince: string;
      tradingPeriodHours: number;
      periodStart: string;
      periodEnd: string;
      deletedComplianceRows: number;
      botRun: {
        runId: string;
        status: string;
        usersProcessed: number;
        successes: number;
        failures: number;
        skipped: number;
      };
    }>("/api/admin/reset-all-daily-limits-and-run-bot");
  },
  userNftDetails() {
    return api.get<{
      summary: {
        totalNftsSold: number;
        totalNftsUnsold: number;
        nftsNotSoldLast24Hours: number;
        totalHold: number;
        totalInSell: number;
      };
      perUser: Array<{
        userId: string;
        publicUserNumber: number;
        referralCode: string;
        userAddress: string;
        totalHold: number;
        totalInSell: number;
      }>;
      staleHoldingsOver18Hours: Array<{
        purchaseTime: string;
        userId: string;
        publicUserNumber: number;
        userAddress: string;
        nftId: string;
        tokenAirdrop: number;
      }>;
    }>("/api/admin/user-nft-details");
  }
};
