import { api } from "../api/client";

export type PublicRulesDto = {
  activation: {
    directSponsorPct: number;
    networkPct: number;
    creatorPct: number;
    burnPct: number;
    liquidityPct: number;
    globalPct: number;
    networkLevels: number;
    networkPerLevelOfActivationPct: number;
  };
  levelUnlock: { minDirect: number; maxLevels: number }[];
  nft: {
    sellPercent: number;
    sellerPct: number;
    levelPct: number;
    burnPct: number;
    liquidityPct: number;
    platformPct: number;
    valueIncreasePct: number;
  };
  trading: { dailyComplianceMinPct: number };
  ranks: Array<{
    rank: string;
    minDirectReferrals: number;
    minTeamSize: number;
    globalPoolSharePct: number;
  }>;
};

export const rewardsService = {
  publicRules() {
    return api.get<PublicRulesDto>("/api/rewards/public-rules");
  }
};
