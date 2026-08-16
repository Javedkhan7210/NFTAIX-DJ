import { useCallback, useEffect, useState } from "react";
import { MobileShell } from "../components/MobileShell";
import { SubScreenHeader } from "../components/SubScreenHeader";
import { useAuth } from "../context/AuthContext";
import { getApiErrorMessage } from "../lib/getApiErrorMessage";
import type { Address } from "viem";
import { approveUsdtForMarketplaceSpend, setMarketplaceAutoTrade } from "../lib/onChainMarketplace";
import { syncPackageActivationIfNeeded } from "../lib/syncPackageActivation";
import { chainService } from "../services/chainService";
import { tradingService, type AutoTradeStatusDto } from "../services/tradingService";
import { userService } from "../services/userService";

export function AutoTradePage() {
  const { hasFullAccess } = useAuth();
  const [activationId, setActivationId] = useState<string | null>(null);
  const [botEnabled, setBotEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [autoTradeChain, setAutoTradeChain] = useState<AutoTradeStatusDto | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
    }
    if (!opts?.silent) {
      setNotice(null);
    }
    try {
      await syncPackageActivationIfNeeded();
      const [pRes, dRes, atRes] = await Promise.all([
        userService.profile(),
        tradingService.dashboard(),
        tradingService.autoTradeStatus().catch(() => null)
      ]);
      const pa = (
        pRes.data as {
          packageActivations?: Array<{
            id: string;
            tier: { name: string };
          }>;
        }
      ).packageActivations?.[0];
      if (pa) {
        setActivationId(pa.id);
      } else {
        setActivationId(null);
      }
      setBotEnabled(dRes.data?.autoTradeBotEnabled ?? false);
      setAutoTradeChain(atRes?.data ?? null);
    } catch {
      setNotice("Could not load trading data.");
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const botToggleAllowed = Boolean(hasFullAccess && activationId);
  const canEnableBot = botToggleAllowed && !botEnabled;

  const applyBotEnabled = async (next: boolean) => {
    setNotice(null);
    if (!hasFullAccess) {
      setNotice("Connect your wallet to save your trading preference.");
      return;
    }
    if (!activationId) {
      setNotice("Activate a package on the Upgrade page first.");
      return;
    }
    if (!next) {
      setNotice("Auto trade cannot be turned off once enabled.");
      return;
    }
    setTogglingBot(true);
    try {
      const statusRes = await chainService.status();
      const mp = statusRes.data.marketplace?.trim();
      const usdt = statusRes.data.usdt?.trim();
      if (!usdt) {
        setNotice("USDT token address is not configured on the API (USDT_CONTRACT_ADDRESS).");
        return;
      }
      if (!mp) {
        setNotice(
          "MARKETPLACE_CONTRACT_ADDRESS is not set on the API — deploy NFTMarketplace and configure it."
        );
        return;
      }
      await approveUsdtForMarketplaceSpend({
        marketplace: mp as Address,
        usdt: usdt as Address
      });
      await setMarketplaceAutoTrade({
        marketplace: mp as Address,
        enabled: true
      });
      await tradingService.setBot(true);
      await load({ silent: true });
      setNotice("Auto trade enabled (USDT allowance + setUserBot on marketplace).");
    } catch (err) {
      setNotice(getApiErrorMessage(err, "Could not update bot."));
    } finally {
      setTogglingBot(false);
    }
  };

  const onEnableBot = async () => {
    if (botEnabled) return;
    await applyBotEnabled(true);
  };

  return (
    <MobileShell>
      <SubScreenHeader />

      {notice ? (
        <p className="mb-3 rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{notice}</p>
      ) : null}

      <div className="neon-card mt-3 p-5">
        <h1 className="text-2xl font-bold tracking-tight text-white">Auto Trade Bot</h1>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <span className="text-sm text-[#8b9bb4]">Status</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${botEnabled ? "bg-[#22E6A0]/20 text-[#22E6A0]" : "bg-white/10 text-white/80"}`}>
            {botEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {!botEnabled ? (
          <button
            type="button"
            disabled={loading || togglingBot || !canEnableBot}
            onClick={() => void onEnableBot()}
            className="mt-4 w-full rounded-xl border border-[#22E6A0]/40 bg-[#22E6A0]/15 px-4 py-3 text-sm font-semibold text-[#22E6A0] transition-colors hover:bg-[#22E6A0]/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Enable Auto Trade
          </button>
        ) : (
          <p className="mt-4 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-xs text-[#8b9bb4]">
            Auto trade stays on while enabled. The bot buys the next FIFO NFT via marketplace{" "}
            <span className="font-mono text-white/70">setUserBot</span> using your USDT allowance.
          </p>
        )}

        {!loading && !botToggleAllowed && !botEnabled ? (
          <p className="mt-3 text-xs text-amber-200/85">
            {!hasFullAccess ? "Connect wallet first." : "Activate a package first."}
          </p>
        ) : null}

        {!loading && autoTradeChain?.keeperExecutorConfigured === false ? (
          <p className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-950/30 px-4 py-3 text-xs text-amber-100/95">
            Server auto-buy is inactive until the API has <span className="font-mono">AUTO_TRADE_EXECUTOR_PRIVATE_KEY</span>{" "}
            configured (pays gas only; your wallet still supplies USDT via marketplace allowance). You can still enable
            on-chain auto trade from this page when NFTMarketplace is configured.
          </p>
        ) : null}
      </div>
    </MobileShell>
  );
}
