import { useCallback, useEffect, useState } from "react";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { WalletAddressWithCopy } from "../../components/WalletAddressWithCopy";

type UserRow = {
  id: string;
  publicUserNumber?: number;
  referralCode: string;
  email?: string | null;
  isActive: boolean;
  blockedReason?: string | null;
  autoTradeBotEnabled?: boolean;
  walletConnections?: Array<{ id: string; walletAddress: string; blocked: boolean }>;
};

export function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [take, setTake] = useState(50);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selId, setSelId] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [sponsorId, setSponsorId] = useState("");
  const [tierId, setTierId] = useState("");
  const [botOn, setBotOn] = useState(false);
  const [walletConnId, setWalletConnId] = useState("");
  const [walletBlocked, setWalletBlocked] = useState(false);
  const [tradeLoadingId, setTradeLoadingId] = useState<string | null>(null);
  const [resetLoadingId, setResetLoadingId] = useState<string | null>(null);
  const [activeAutoTradeBots, setActiveAutoTradeBots] = useState<number | null>(null);
  const [freeUserWallet, setFreeUserWallet] = useState("");
  const [freeSponsorWallet, setFreeSponsorWallet] = useState("");
  const [freePackageId, setFreePackageId] = useState("1");
  const [freeBusy, setFreeBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const skip = Math.max(0, (page - 1) * take);
      const res = await adminService.usersSearch({ q: q.trim() || undefined, take, skip });
      setRows((res.data.rows as UserRow[]) ?? []);
      setTotal(Number(res.data.total) || 0);
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Could not load users."));
    } finally {
      setLoading(false);
    }
  }, [q, page, take]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void adminService
      .stats()
      .then((res) => {
        if (!cancelled) setActiveAutoTradeBots(res.data.activeAutoTradeBots);
      })
      .catch(() => {
        if (!cancelled) setActiveAutoTradeBots(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [page, take]);

  const applyStatus = async (isActive: boolean) => {
    if (!selId.trim()) {
      setNotice("Enter user id.");
      return;
    }
    try {
      await adminService.patchUserStatus(selId.trim(), {
        isActive,
        ...(blockedReason.trim() ? { blockedReason: blockedReason.trim() } : {}),
        ...(!blockedReason.trim() && !isActive ? {} : {})
      });
      setNotice(isActive ? "User activated." : "User deactivated.");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Update failed."));
    }
  };

  const clearBlock = async () => {
    if (!selId.trim()) return;
    try {
      await adminService.patchUserStatus(selId.trim(), { clearBlockedReason: true });
      setBlockedReason("");
      setNotice("Block reason cleared.");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Failed."));
    }
  };

  const rewire = async () => {
    if (!selId.trim()) return;
    try {
      await adminService.rewireSponsor(selId.trim(), sponsorId.trim() || null);
      setNotice("Sponsor rewired (leaf users only).");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Rewire failed."));
    }
  };

  const grantPkg = async () => {
    if (!selId.trim() || !tierId.trim()) {
      setNotice("Need user id + tier id.");
      return;
    }
    try {
      await adminService.grantPackage(selId.trim(), {
        tierId: tierId.trim(),
        runIncomeDistribution: false,
        reason: "admin_panel"
      });
      setNotice("Package granted.");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Grant failed."));
    }
  };

  const freeRegister = async () => {
    if (!freeUserWallet.trim() || !freeSponsorWallet.trim()) {
      setNotice("Need user wallet + sponsor wallet.");
      return;
    }
    setFreeBusy(true);
    setNotice(null);
    try {
      const res = await adminService.freeRegisterActivate({
        userWallet: freeUserWallet.trim(),
        sponsorWallet: freeSponsorWallet.trim(),
        packageId: Number(freePackageId) || 1
      });
      setNotice(`Free register+activate ok · package ${res.data.packageId} · tx ${res.data.txHash}`);
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Free register failed."));
    } finally {
      setFreeBusy(false);
    }
  };

  const freeUpgrade = async () => {
    if (!freeUserWallet.trim()) {
      setNotice("Need user wallet.");
      return;
    }
    const pkg = Number(freePackageId) || 0;
    if (pkg < 2) {
      setNotice("Upgrade package id must be 2–11.");
      return;
    }
    setFreeBusy(true);
    setNotice(null);
    try {
      const res = await adminService.freeUpgrade({
        userWallet: freeUserWallet.trim(),
        packageId: pkg
      });
      setNotice(`Free upgrade ok · package ${res.data.packageId} · tx ${res.data.txHash}`);
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Free upgrade failed."));
    } finally {
      setFreeBusy(false);
    }
  };

  const setBot = async () => {
    if (!selId.trim()) return;
    try {
      await adminService.setUserAutoTradeBot(selId.trim(), botOn);
      setNotice("Auto trade preference flag updated.");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Bot update failed."));
    }
  };

  const toggleWalletBlock = async () => {
    if (!selId.trim() || !walletConnId.trim()) {
      setNotice("Need user id + wallet connection id.");
      return;
    }
    try {
      await adminService.blockWallet(selId.trim(), walletConnId.trim(), walletBlocked);
      setNotice("Wallet block updated.");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Wallet block failed."));
    }
  };

  const recount = async () => {
    try {
      const r = await adminService.recountReferrals();
      setNotice(`Recount done: ${r.data.usersUpdated} users.`);
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Recount failed."));
    }
  };

  const resetTradingLimit = async (userId: string) => {
    if (
      !window.confirm(
        "Clear ALL trading volume for this user's current package in the database? Package limit and daily bot budget will refresh. On-chain marketplace caps are unchanged."
      )
    ) {
      return;
    }
    setResetLoadingId(userId);
    setNotice(null);
    try {
      const res = await adminService.resetUserTradingLimit(userId);
      const { previousTodayVolume, packageTradingLimit, dailyAllowance } = res.data;
      setNotice(
        `Daily limit reset: cleared $${previousTodayVolume.toFixed(2)} this period · cap $${dailyAllowance.toFixed(2)} (${packageTradingLimit.toFixed(0)} tier, resets every 15h).`
      );
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Reset failed."));
    } finally {
      setResetLoadingId(null);
    }
  };

  const tradeNow = async (userId: string, autoTradeOn: boolean) => {
    if (!autoTradeOn) return;
    setTradeLoadingId(userId);
    setNotice(null);
    try {
      const res = await adminService.triggerUserManualTrade(userId);
      const {
        successes,
        failures,
        skipped,
        purchasesAttempted,
        failureReason,
        lastChainTxHash,
        lastTokenId
      } = res.data;
      if (successes > 0) {
        const parts = [
          `${successes} NFT purchase${successes === 1 ? "" : "s"} completed`,
          purchasesAttempted > successes ? `(${purchasesAttempted} attempts)` : null,
          lastTokenId ? `last NFT ${lastTokenId}` : null,
          lastChainTxHash ? `tx ${lastChainTxHash.slice(0, 10)}…` : null
        ].filter(Boolean);
        setNotice(parts.join(" · "));
      } else if (skipped > 0 || !purchasesAttempted) {
        setNotice(failureReason ?? "No purchases (package limit, balance, or queue).");
      } else {
        setNotice(failureReason ?? `Trade failed after ${failures} error(s).`);
      }
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Manual trade failed."));
    } finally {
      setTradeLoadingId(null);
    }
  };

  const selectedUser = rows.find((u) => u.id === selId.trim());
  const selectedAutoTradeOn = Boolean(selectedUser?.autoTradeBotEnabled);

  return (
    <div className="space-y-4">
      {notice ? (
        <p className="rounded-xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">{notice}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {activeAutoTradeBots != null ? (
          <span className="rounded-xl border border-[#22E6A0]/35 bg-[#22E6A0]/10 px-3 py-2 text-sm font-semibold text-[#22E6A0]">
            Active bots: <span className="font-mono">{activeAutoTradeBots}</span>
          </span>
        ) : null}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search id / referral / email / wallet"
          className="min-w-[200px] flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
        />
        <select
          value={take}
          onChange={(e) => {
            setTake(Number(e.target.value) || 50);
            setPage(1);
          }}
          className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-neon-fill px-4 py-2 text-sm"
          onClick={() => {
            setPage(1);
            void load();
          }}
          disabled={loading}
        >
          Search
        </button>
        <button type="button" className="rounded-xl border border-white/20 px-4 py-2 text-sm" onClick={() => void recount()}>
          Recount all referral stats
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8b9bb4]">
        <span>
          Showing{" "}
          <span className="font-mono text-white">
            {rows.length ? (page - 1) * take + 1 : 0}–{(page - 1) * take + rows.length}
          </span>{" "}
          of <span className="font-mono text-white">{total}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-white/20 px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span className="font-mono text-white">Page {page}</span>
          <button
            type="button"
            className="rounded-xl border border-white/20 px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={loading || page * take >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      <div className="neon-card overflow-x-auto p-3">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[#8b9bb4]">
              <th className="p-2">User #</th>
              <th className="p-2">User id</th>
              <th className="p-2">Ref code</th>
              <th className="p-2">Active</th>
              <th className="p-2">Blocked</th>
              <th className="p-2">Auto pref</th>
              <th className="p-2">Trade / limit</th>
              <th className="p-2">Wallets</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-white/5 font-mono">
                <td className="p-2 text-white">{u.publicUserNumber ?? "—"}</td>
                <td className="max-w-[160px] truncate p-2 text-white" title={u.id}>
                  {u.id}
                </td>
                <td className="p-2">{u.referralCode}</td>
                <td className="p-2">{u.isActive ? "yes" : "no"}</td>
                <td className="max-w-[100px] truncate p-2">{u.blockedReason ?? "—"}</td>
                <td className="p-2">{u.autoTradeBotEnabled ? "on" : "off"}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={!u.autoTradeBotEnabled || tradeLoadingId === u.id}
                    title={
                      u.autoTradeBotEnabled
                        ? "Burst-buy FIFO resales until package limit or wallet USDT"
                        : "Enable Auto Trade for this user first"
                    }
                      onClick={() => void tradeNow(u.id, Boolean(u.autoTradeBotEnabled))}
                      className="rounded-lg border border-[#22E6A0]/40 bg-[#22E6A0]/10 px-2 py-1 text-[11px] font-semibold text-[#22E6A0] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-[#4a5568]"
                    >
                      {tradeLoadingId === u.id ? "Trading…" : "Trade Now"}
                    </button>
                    <button
                      type="button"
                      disabled={resetLoadingId === u.id}
                      title="Clear package trading volume in DB (app package + daily limits)"
                      onClick={() => void resetTradingLimit(u.id)}
                      className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-200 disabled:opacity-50"
                    >
                      {resetLoadingId === u.id ? "Resetting…" : "Reset limit"}
                    </button>
                  </div>
                </td>
                <td className="p-2 text-[10px] text-[#8b9bb4]">
                  {(u.walletConnections ?? []).map((w) => (
                    <span key={w.id} className="mr-1 block truncate">
                      <WalletAddressWithCopy addressFull={w.walletAddress} addressClassName="font-mono text-[10px] text-[#8b9bb4]" />
                      {w.blocked ? " (blocked)" : ""}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="neon-card space-y-3 p-4">
        <p className="label-caps">Free on-chain register / upgrade (no USDT)</p>
        <p className="text-xs text-[#8b9bb4]">
          Uses Registration <span className="font-mono">adminRegisterAndActivate</span> /{" "}
          <span className="font-mono">adminUpgrade</span>. Superadmin + owner/authorizer key required.
        </p>
        <input
          value={freeUserWallet}
          onChange={(e) => setFreeUserWallet(e.target.value)}
          placeholder="User wallet 0x…"
          className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
        />
        <input
          value={freeSponsorWallet}
          onChange={(e) => setFreeSponsorWallet(e.target.value)}
          placeholder="Sponsor wallet 0x… (register only)"
          className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[#8b9bb4]">
            Package id{" "}
            <input
              value={freePackageId}
              onChange={(e) => setFreePackageId(e.target.value)}
              className="ml-1 w-16 rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-white"
            />
          </label>
          <button
            type="button"
            disabled={freeBusy}
            onClick={() => void freeRegister()}
            className="rounded-xl border border-[#22E6A0]/40 bg-[#22E6A0]/10 px-3 py-2 text-xs font-semibold text-[#22E6A0] disabled:opacity-50"
          >
            {freeBusy ? "…" : "Free register + activate"}
          </button>
          <button
            type="button"
            disabled={freeBusy}
            onClick={() => void freeUpgrade()}
            className="rounded-xl border border-[#00D1FF]/40 bg-[#00D1FF]/10 px-3 py-2 text-xs font-semibold text-[#00D1FF] disabled:opacity-50"
          >
            {freeBusy ? "…" : "Free upgrade"}
          </button>
        </div>
      </div>

      <div className="neon-card space-y-3 p-4">
        <p className="label-caps">Actions (paste internal user id)</p>
        <input
          value={selId}
          onChange={(e) => setSelId(e.target.value)}
          placeholder="cuid from User id column (not the numeric User #)"
          className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
        />
        <input
          value={blockedReason}
          onChange={(e) => setBlockedReason(e.target.value)}
          placeholder="Blocked reason (shown on 403) — optional"
          className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl bg-white/10 px-3 py-2 text-sm" onClick={() => void applyStatus(true)}>
            Activate
          </button>
          <button type="button" className="rounded-xl bg-red-500/20 px-3 py-2 text-sm" onClick={() => void applyStatus(false)}>
            Deactivate
          </button>
          <button type="button" className="rounded-xl border border-white/20 px-3 py-2 text-sm" onClick={() => void clearBlock()}>
            Clear block reason
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-3">
          <div className="min-w-[200px] flex-1">
            <label className="text-[10px] uppercase text-[#8b9bb4]">Rewire sponsor (leaf users only)</label>
            <input
              value={sponsorId}
              onChange={(e) => setSponsorId(e.target.value)}
              placeholder="New sponsor user id or empty"
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
            />
          </div>
          <button type="button" className="btn-neon-fill px-4 py-2 text-sm" onClick={() => void rewire()}>
            Rewire
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-3">
          <div className="min-w-[200px] flex-1">
            <label className="text-[10px] uppercase text-[#8b9bb4]">Grant package (tier id)</label>
            <input
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              placeholder="PackageTier id"
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
            />
          </div>
          <button type="button" className="btn-neon-fill px-4 py-2 text-sm" onClick={() => void grantPkg()}>
            Grant tier
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={botOn} onChange={(e) => setBotOn(e.target.checked)} />
            User auto-trade preference (UI flag only — no server-side volume fill)
          </label>
          <button type="button" className="rounded-xl border border-white/20 px-4 py-2 text-sm" onClick={() => void setBot()}>
            Apply bot flag
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
          <p className="text-[10px] uppercase text-[#8b9bb4]">Manual trade (selected user)</p>
          <button
            type="button"
            disabled={!selId.trim() || !selectedAutoTradeOn || tradeLoadingId === selId.trim()}
            title={
              !selId.trim()
                ? "Select a user id above"
                : !selectedAutoTradeOn
                  ? "Enable Auto Trade for this user first"
                  : "Burst-buy FIFO resales until package limit or wallet USDT"
            }
            onClick={() => void tradeNow(selId.trim(), selectedAutoTradeOn)}
            className="rounded-xl bg-[#22E6A0] px-4 py-2 text-sm font-semibold text-[#060812] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tradeLoadingId === selId.trim() ? "Trading…" : "Trade Now"}
          </button>
          <button
            type="button"
            disabled={!selId.trim() || resetLoadingId === selId.trim()}
            title="Clear package trading volume in DB for the selected user"
            onClick={() => void resetTradingLimit(selId.trim())}
            className="rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resetLoadingId === selId.trim() ? "Resetting…" : "Reset trading limit"}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-3">
          <div className="min-w-[200px] flex-1">
            <label className="text-[10px] uppercase text-[#8b9bb4]">Wallet connection id + block</label>
            <input
              value={walletConnId}
              onChange={(e) => setWalletConnId(e.target.value)}
              placeholder="WalletConnection cuid"
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={walletBlocked} onChange={(e) => setWalletBlocked(e.target.checked)} />
            Blocked
          </label>
          <button type="button" className="rounded-xl border border-white/20 px-4 py-2 text-sm" onClick={() => void toggleWalletBlock()}>
            Apply wallet block
          </button>
        </div>
        <p className="text-[11px] text-[#8b9bb4]">
          On-chain bot status is only set via NFTMarketplace setUserBot. This toggle matches the user Auto Trade DB bot.
        </p>
      </div>
    </div>
  );
}
