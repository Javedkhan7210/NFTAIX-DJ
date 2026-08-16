import { useEffect, useState } from "react";
import type { Address } from "viem";
import { formatMoney, sumIncomeAmount } from "../lib/formatCrypto";
import { readWalletUsdtBalance } from "../lib/readWalletUsdtBalance";
import { getInjectedProvider, peekWalletAddress, refreshWalletProviders } from "../lib/wallet";
import { incomeService } from "../services/incomeService";
import { chainService } from "../services/chainService";
import { userService } from "../services/userService";
import { WalletAddressWithCopy } from "./WalletAddressWithCopy";
import { useAuth } from "../context/AuthContext";

function asAddress(value: string | null | undefined): Address | null {
  const s = value?.trim() ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(s) ? (s as Address) : null;
}

type ProfileRow = {
  id?: string;
  publicUserNumber?: number;
  walletConnections?: { walletAddress: string; isPrimary: boolean }[];
};

type Cached = {
  profile: ProfileRow | null;
  globalTeamCount: number | null;
  activeTotal: number | null;
  fetchedAtMs: number;
};

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

/** Clears module-level cache so user switching won't show stale stats. */
export function clearHeaderStatsCache() {
  cache = null;
  inFlight = null;
}

async function fetchHeaderStats(): Promise<Cached> {
  const [pRes, gRes, wRes] = await Promise.all([
    userService.profile().catch(() => null),
    userService.globalTeam().catch(() => null),
    incomeService.wallet().catch(() => null)
  ]);
  const profile = (pRes?.data as ProfileRow | undefined) ?? null;
  const globalTeamCount = Array.isArray(gRes?.data) ? gRes.data.length : null;
  const unlocked = (wRes?.data as { unlocked?: Array<{ amount: string | number; status: string; incomeType: string }> })?.unlocked ?? [];
  const locked = (wRes?.data as { locked?: Array<{ amount: string | number; status: string; incomeType: string }> })?.locked ?? [];
  const activeTotal = unlocked.length || locked.length ? sumIncomeAmount(unlocked) + sumIncomeAmount(locked) : null;
  return { profile, globalTeamCount, activeTotal, fetchedAtMs: Date.now() };
}

function getCachedOrFetch(ttlMs: number): Promise<Cached> {
  if (cache && Date.now() - cache.fetchedAtMs < ttlMs) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = fetchHeaderStats()
      .then((c) => {
        cache = c;
        return c;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function HeaderStatsBar({
  ttlMs = 30_000,
  showWallet = true
}: {
  ttlMs?: number;
  showWallet?: boolean;
}) {
  const { hasFullAccess, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null>(cache?.profile ?? null);
  const [globalTeamCount, setGlobalTeamCount] = useState<number | null>(cache?.globalTeamCount ?? null);
  const [activeTotal, setActiveTotal] = useState<number | null>(cache?.activeTotal ?? null);
  const [connectedWallet, setConnectedWallet] = useState<Address | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  const [usdtLoading, setUsdtLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null);
      setGlobalTeamCount(null);
      setActiveTotal(null);
      setConnectedWallet(null);
      setUsdtBalance(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getCachedOrFetch(ttlMs)
      .then((c) => {
        if (cancelled) return;
        setProfile(c.profile);
        setGlobalTeamCount(c.globalTeamCount);
        setActiveTotal(c.activeTotal);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, ttlMs]);

  const primary = profile?.walletConnections?.[0];
  const savedWallet = asAddress(primary?.walletAddress);
  const walletForUsdt = savedWallet ?? connectedWallet;
  const isWalletConnected = showWallet && savedWallet != null;
  const hasWallet = showWallet && (connectedWallet != null || savedWallet != null);

  useEffect(() => {
    // Only treat an injected provider as live after a wallet-signed session
    // (walletSession). Unlocked MetaMask alone must not look "connected".
    if (!showWallet || !hasFullAccess) {
      setConnectedWallet(null);
      return;
    }

    let cancelled = false;
    const readAccounts = async () => {
      const addr = asAddress(await peekWalletAddress());
      if (!cancelled) setConnectedWallet(addr);
    };

    refreshWalletProviders();
    void readAccounts();

    let announceTimer: ReturnType<typeof setTimeout> | null = null;
    const onAnnounce = () => {
      if (announceTimer) clearTimeout(announceTimer);
      announceTimer = setTimeout(() => {
        void readAccounts();
      }, 150);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    const retryA = window.setTimeout(() => void readAccounts(), 400);

    const onAccountsChanged = (accs: unknown) => {
      const a = Array.isArray(accs) ? accs[0] : null;
      setConnectedWallet(typeof a === "string" ? asAddress(a) : null);
    };

    type ProviderEvents = {
      on?(event: string, handler: (accs: unknown) => void): void;
      removeListener?(event: string, handler: (accs: unknown) => void): void;
    };
    let injected: ProviderEvents | undefined;
    try {
      injected = getInjectedProvider() as ProviderEvents;
      injected.on?.("accountsChanged", onAccountsChanged);
    } catch {
      injected = undefined;
    }

    return () => {
      cancelled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (announceTimer) clearTimeout(announceTimer);
      window.clearTimeout(retryA);
      try {
        injected?.removeListener?.("accountsChanged", onAccountsChanged);
      } catch {
        // ignore
      }
    };
  }, [hasFullAccess, showWallet]);

  useEffect(() => {
    if (!showWallet || !walletForUsdt) {
      setUsdtBalance(null);
      setUsdtLoading(false);
      return;
    }
    let cancelled = false;
    let firstLoad = true;
    const load = async () => {
      if (firstLoad) setUsdtLoading(true);
      try {
        const st = (await chainService.status()).data;
        const usdt = asAddress(st.usdt);
        if (!usdt || typeof st.chainId !== "number") {
          if (!cancelled) setUsdtBalance(null);
          return;
        }
        const bal = await readWalletUsdtBalance(usdt, walletForUsdt, st.chainId);
        if (!cancelled) setUsdtBalance(Number.isFinite(bal) ? bal : null);
      } catch {
        if (!cancelled) setUsdtBalance(null);
      } finally {
        firstLoad = false;
        if (!cancelled) setUsdtLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [walletForUsdt, showWallet]);

  const userIdLabel =
    profile?.publicUserNumber != null
      ? String(profile.publicUserNumber)
      : profile?.id
        ? `${profile.id.slice(0, 8)}…`
        : "—";

  const walletForDisplayAndCopy = savedWallet ?? connectedWallet;
  const emptyLabel = loading ? "…" : hasWallet ? undefined : "—";

  return (
    <div className="neon-card px-4 py-3">
      {/* Mobile: aligned rows. Desktop: 3 columns. */}
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-3 sm:gap-3">
        <div className="flex items-center justify-between gap-3 sm:block">
          <p className="label-caps">User ID</p>
          <p className="font-mono text-sm font-bold text-white sm:mt-0.5">{loading ? "…" : userIdLabel}</p>
        </div>

        {loading || hasWallet ? (
          <div className="flex items-start justify-between gap-3 sm:block">
            <p className="label-caps">Wallet</p>
            <div className="min-w-0 text-right sm:mt-0.5 sm:text-left">
              <WalletAddressWithCopy
                addressFull={walletForDisplayAndCopy}
                emptyLabel={emptyLabel ?? "—"}
                lead={2}
                tail={3}
                buttonSize="sm"
                wrap={false}
                addressClassName="truncate font-mono text-sm font-bold tracking-tight text-white"
                className="max-w-full justify-end sm:justify-start"
              />
              
              <div className="mt-1 flex flex-wrap items-center justify-end gap-2 sm:justify-start">
                <span className="font-mono text-sm font-bold text-white">
                  {usdtLoading ? "…" : usdtBalance == null ? "—" : `${formatMoney(usdtBalance, "")} USDT`}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden sm:block" />
        )}

        <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
          <p className="label-caps">Global Team</p>
          <p className="font-mono text-sm font-bold text-white sm:mt-0.5">
            {loading ? "…" : globalTeamCount != null ? String(globalTeamCount) : "—"}
          </p>
          <div className="mt-1 flex justify-end sm:justify-end">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                isWalletConnected ? "border-[#22E6A0]/35 bg-[#22E6A0]/10 text-[#22E6A0]" : "border-white/10 bg-white/5 text-[#8b9bb4]"
              }`}
            >
              {isWalletConnected ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

