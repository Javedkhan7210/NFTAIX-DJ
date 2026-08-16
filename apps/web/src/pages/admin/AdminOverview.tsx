import { useEffect, useState } from "react";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";

export function AdminOverview() {
  const [logs, setLogs] = useState<unknown[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let c = false;
    void (async () => {
      try {
        const res = await adminService.adminLogs(15);
        if (!c) setLogs(res.data as unknown[]);
      } catch (e) {
        if (!c) setErr(getApiErrorMessage(e, "Could not load admin logs."));
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b9bb4]">
        Master controls are grouped by tabs above: dashboard content controls, user block/deactivate/reactivate, manual package
        upgrades, income and daily limit keys, NFT activity/listings, and wallet bot + on-chain contract operations.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="neon-card p-4 text-sm text-[#8b9bb4]">
          <p className="label-caps mb-2">User Dashboard Controls</p>
          <p>Update notifications, banners, slides, offers, Coming Soon, Telegram, and WhatsApp from Dashboard CMS.</p>
        </div>
        <div className="neon-card p-4 text-sm text-[#8b9bb4]">
          <p className="label-caps mb-2">User Management</p>
          <p>Search users, block/deactivate/reactivate accounts, rewire sponsor placement, and trigger package step upgrades.</p>
        </div>
        <div className="neon-card p-4 text-sm text-[#8b9bb4]">
          <p className="label-caps mb-2">Income and Subscription</p>
          <p>Configure income/reward keys, subscription limits, and daily cap behavior in Economy settings.</p>
        </div>
        <div className="neon-card p-4 text-sm text-[#8b9bb4]">
          <p className="label-caps mb-2">NFT, Transactions, Wallet Bot</p>
          <p>
            Monitor on-chain FIFO buys/sells (auto-list after buy), run chain sync, and toggle user auto-trade bot
            controls. DB catalog is not the live market source.
          </p>
        </div>
      </div>
      <div className="neon-card p-4">
        <p className="label-caps mb-2">Recent admin actions</p>
        {err ? <p className="text-sm text-amber-200">{err}</p> : null}
        {!logs && !err ? <p className="text-sm text-[#8b9bb4]">Loading…</p> : null}
        {logs ? (
          <ul className="max-h-80 space-y-2 overflow-y-auto text-xs font-mono text-[#8b9bb4]">
            {logs.map((row) => {
              const r = row as {
                id: string;
                action: string;
                createdAt: string;
                targetType: string;
                actor?: { referralCode?: string };
              };
              return (
                <li key={r.id} className="border-b border-white/5 pb-2">
                  <span className="text-white">{r.action}</span> · {r.targetType} ·{" "}
                  {new Date(r.createdAt).toLocaleString()} · by {r.actor?.referralCode ?? "—"}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
