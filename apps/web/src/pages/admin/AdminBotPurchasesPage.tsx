import { useCallback, useEffect, useState } from "react";
import { adminService, type BotPurchaseRunDetailDto, type BotPurchaseRunSummaryDto } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { formatMoney } from "../../lib/formatCrypto";
import { ExplorerTxLink } from "../../components/ExplorerTxLink";

function statusBadge(status: string) {
  const base = "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";
  if (status === "success") return `${base} bg-emerald-500/20 text-emerald-300`;
  if (status === "failed") return `${base} bg-red-500/20 text-red-300`;
  if (status === "skipped") return `${base} bg-amber-500/20 text-amber-200`;
  if (status === "completed") return `${base} bg-emerald-500/20 text-emerald-300`;
  if (status === "running") return `${base} bg-sky-500/20 text-sky-200`;
  return `${base} bg-white/10 text-[#8b9bb4]`;
}

export function AdminBotPurchasesPage() {
  const [runs, setRuns] = useState<BotPurchaseRunSummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BotPurchaseRunDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeAutoTradeBots, setActiveAutoTradeBots] = useState<number | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await adminService.botPurchaseRuns();
      const list = res.data ?? [];
      setRuns(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Could not load bot runs."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

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
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setDetailLoading(true);
      try {
        const res = await adminService.botPurchaseRun(selectedId);
        if (!cancelled) setDetail(res.data);
      } catch (e) {
        if (!cancelled) setNotice(getApiErrorMessage(e, "Could not load run detail."));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const onTrigger = async () => {
    setTriggering(true);
    setNotice(null);
    try {
      const res = await adminService.triggerBotPurchaseRun();
      setNotice(
        `Run finished: ${res.data.successes} success, ${res.data.failures} failed, ${res.data.skipped} skipped.`
      );
      setSelectedId(res.data.runId);
      await loadRuns();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Could not start bot run."));
    } finally {
      setTriggering(false);
    }
  };

  const onResetAllDailyAndRunBot = async () => {
    if (
      !window.confirm(
        "Reset DAILY allowance for ALL users (15h period), then run the bot. Each auto-trade user may buy multiple NFTs until daily cap or wallet USDT runs out. Per-user package volume resets are NOT changed. Continue?"
      )
    ) {
      return;
    }
    setResettingAll(true);
    setNotice(null);
    try {
      const res = await adminService.resetAllDailyLimitsAndRunBot();
      const bot = res.data.botRun;
      setNotice(
        `All users daily limit reset (${res.data.globalDailyVolumeSince}). Bot: ${bot.successes} success, ${bot.failures} failed, ${bot.skipped} skipped.`
      );
      setSelectedId(bot.runId);
      await loadRuns();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Could not reset daily limits and run bot."));
    } finally {
      setResettingAll(false);
    }
  };

  const summary = detail?.summary as
    | { successes?: number; failures?: number; skipped?: number; usersEligible?: number }
    | null
    | undefined;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white">Resale bot purchases</h2>
        <p className="mt-1 text-sm text-[#8b9bb4]">
          Sequential NFT resales for users with auto-trade enabled. Per user: FIFO resale first, then cheapest
          affordable, then primary mint if none available — until daily allowance or wallet USDT is used.
        </p>
        {activeAutoTradeBots != null ? (
          <p className="mt-2 text-sm font-semibold text-[#22E6A0]">
            Active auto-trade bots: <span className="font-mono">{activeAutoTradeBots}</span>
          </p>
        ) : null}
      </div>

      {notice ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">{notice}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={resettingAll || triggering}
          onClick={() => void onResetAllDailyAndRunBot()}
          className="rounded-xl bg-[#7B2FF7] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {resettingAll ? "Resetting & trading…" : "Reset all daily (not package) + run bot"}
        </button>
        <button
          type="button"
          disabled={triggering || resettingAll}
          onClick={() => void onTrigger()}
          className="rounded-xl bg-[#22E6A0] px-4 py-2 text-sm font-semibold text-[#060812] disabled:opacity-50"
        >
          {triggering ? "Running…" : "Run bot now"}
        </button>
        <button
          type="button"
          onClick={() => void loadRuns()}
          className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="neon-card max-h-[70vh] overflow-y-auto p-2">
          <p className="label-caps mb-2 px-2">Recent runs</p>
          {loading ? (
            <p className="px-2 text-sm text-[#8b9bb4]">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="px-2 text-sm text-[#8b9bb4]">No runs yet.</p>
          ) : (
            <ul className="space-y-1">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                      selectedId === r.id ? "bg-[#22E6A0]/15 text-white" : "text-[#8b9bb4] hover:bg-white/5"
                    }`}
                  >
                    <span className={statusBadge(r.status)}>{r.status}</span>
                    <span className="mt-1 block text-xs text-[#6b7a90]">
                      {new Date(r.startedAt).toLocaleString()} · {r.attemptCount} users · {r.trigger}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="neon-card overflow-x-auto p-3">
          {detailLoading ? (
            <p className="text-sm text-[#8b9bb4]">Loading run…</p>
          ) : !detail ? (
            <p className="text-sm text-[#8b9bb4]">Select a run.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={statusBadge(detail.status)}>{detail.status}</span>
                <span className="text-xs text-[#8b9bb4]">
                  {new Date(detail.startedAt).toLocaleString()}
                  {detail.finishedAt ? ` → ${new Date(detail.finishedAt).toLocaleString()}` : ""}
                </span>
                {summary ? (
                  <span className="text-xs text-[#8b9bb4]">
                    {summary.successes ?? 0} ok · {summary.failures ?? 0} fail · {summary.skipped ?? 0} skip
                  </span>
                ) : null}
              </div>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[#8b9bb4]">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">User</th>
                    <th className="py-2 pr-2">Budget</th>
                    <th className="py-2 pr-2">NFT</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2">Reason / tx</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.attempts.map((a) => (
                    <tr key={a.id} className="border-b border-white/5">
                      <td className="py-2 pr-2 tabular-nums">{a.sortOrder}</td>
                      <td className="py-2 pr-2">
                        <span className="font-medium text-white">#{a.publicUserNumber}</span>
                        <span className="mt-0.5 block text-[10px] text-[#6b7a90]">{a.userId.slice(0, 8)}…</span>
                      </td>
                      <td className="py-2 pr-2 text-xs">
                        <div>Package limit left: {formatMoney(a.targetRemainingUsdt)}</div>
                        <div>Balance: {formatMoney(a.balanceUsdt)}</div>
                        <div className="font-semibold text-white">Budget: {formatMoney(a.budgetUsdt)}</div>
                      </td>
                      <td className="py-2 pr-2 text-xs">
                        {a.tokenId ? (
                          <>
                            #{a.tokenId}
                            {a.effectivePayUsdt != null ? (
                              <span className="block text-[#8b9bb4]">{formatMoney(a.effectivePayUsdt)} USDT</span>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={statusBadge(a.status)}>{a.status}</span>
                      </td>
                      <td className="py-2 text-xs text-[#8b9bb4]">
                        {a.failureReason ? <span className="block max-w-xs">{a.failureReason}</span> : null}
                        {a.chainTxHash ? (
                          <ExplorerTxLink txHash={a.chainTxHash} className="mt-1 inline-block text-[#22E6A0]" />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
