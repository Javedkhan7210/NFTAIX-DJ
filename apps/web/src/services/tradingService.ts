import { api } from "../api/client";
import { coercePaginated, type Paginated } from "../lib/pagination";

const DEFAULT_PAGE_SIZE = 20;

export type ComplianceHistoryRow = {
  id: string;
  day: string;
  requiredVolume: string | number;
  achievedVolume: string | number;
  status: "compliant" | "non_compliant" | "inactive";
  consecutiveMiss: number;
};

export type VolumeLogRow = {
  id: string;
  tradeDate: string;
  volume: number;
  allowedDailyVolume: number;
  tierName: string;
  chainTxHash: string | null;
  relatedTokenId: string | null;
};

export type AutoTradeStatusDto = {
  chainConfigured: boolean;
  hasPrimaryWallet: boolean;
  walletAddress?: string;
  /** USDT allowance for marketplace when deployed (`Unlimited` when max approve) */
  usdtAllowance: string;
  /** Marketplace `setUserBot` enrollment */
  autoTradeOnChain: boolean;
  botValidUntil: string | null;
  /** Legacy field — prefer marketplace allowance / autoTradeOnChain */
  module?: null | {
    configured: true;
    usdtAllowance: string;
    enabledOnChain: boolean;
  };
  /** `AUTO_TRADE_EXECUTOR_PRIVATE_KEY` set on API — required for server-side keeper txs */
  keeperExecutorConfigured?: boolean;
  tradingPeriodHours?: number;
  /** UTC keeper schedule (`AUTO_TRADE_KEEPER_*`). */
  keeperDailyUtcHour?: number;
  keeperDailyUtcMinute?: number;
  keeperIntervalHours?: number;
  keeperScheduleSummary?: string;
  /** Approximate ISO time of the next scheduled bot run (period boundary). */
  keeperNextRunUtc?: string;
};

export type TradingDashboardDto = {
  autoTradeBotEnabled: boolean;
  currentTier: {
    id: string;
    name: string;
    activationAmount: number;
    tradingLimit: number;
    dailyAllowance: number;
  } | null;
  totalTradedVolume: number;
  remainingTradingLimit: number;
  tradingPeriodHours?: number;
  periodEndsAt?: string;
  todayCompliance: {
    day: string;
    periodEndsAt?: string;
    requiredVolume: number;
    achievedVolume: number;
    status: string;
  } | null;
};

export const tradingService = {
  submit(body: { packageActivationId: string; tradeDate: string; volume: number }) {
    return api.post("/api/trading/submit", body);
  },
  setBot(enabled: boolean) {
    return api.patch<{ enabled: boolean }>("/api/trading/bot", { enabled });
  },
  complianceHistory(params?: { page?: number; limit?: number }) {
    const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
    return api
      .get<Paginated<ComplianceHistoryRow> | ComplianceHistoryRow[]>("/api/trading/compliance", {
        params
      })
      .then((res) => ({ ...res, data: coercePaginated<ComplianceHistoryRow>(res.data, limit) }));
  },
  volumeLogs(params?: { page?: number; limit?: number }) {
    const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
    return api
      .get<Paginated<VolumeLogRow> | VolumeLogRow[]>("/api/trading/logs", { params })
      .then((res) => ({ ...res, data: coercePaginated<VolumeLogRow>(res.data, limit) }));
  },
  dashboard() {
    return api.get<TradingDashboardDto>("/api/trading/dashboard");
  },
  autoTradeStatus() {
    return api.get<AutoTradeStatusDto>("/api/trading/auto-trade-status");
  }
};
