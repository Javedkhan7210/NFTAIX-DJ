import { api } from "../api/client";

function incomeNoCacheConfig() {
  return {
    params: { _: Date.now() },
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } as const
  };
}

export const incomeService = {
  wallet() {
    return api.get("/api/income/wallet", incomeNoCacheConfig());
  },
  history() {
    return api.get("/api/income/history", incomeNoCacheConfig());
  },
  nftExtraEarned() {
    return api.get<{ extraEarned: number; todayExtraEarned: number }>(
      "/api/income/nft-extra-earned",
      incomeNoCacheConfig()
    );
  },
  nftLevelIncomeSummary() {
    return api.get<{ nftLevelIncome: number; todayNftLevelIncome: number }>(
      "/api/income/nft-level-income-summary",
      incomeNoCacheConfig()
    );
  },
  registrationRewardSummary() {
    return api.get<{
      directIncome: number;
      sublevelIncome: number;
      todayDirectIncome: number;
      todaySublevelIncome: number;
      nftLevelIncome: number;
      todayNftLevelIncome: number;
      tradingIncome: number;
      todayTradingIncome: number;
      packageTradingVolumeUsdt: number;
      todayPackageTradingVolumeUsdt: number;
      holdNftAmountUsdt?: number;
      totalSpentUsdt?: number;
      incomeFromPackageUsdt?: number;
      tradingIncomeFromPackageUsdt?: number;
      currentPackageActivationUsdt?: number;
      tokenAirdropScore?: number;
    }>("/api/income/registration-reward-summary", incomeNoCacheConfig());
  }
};
