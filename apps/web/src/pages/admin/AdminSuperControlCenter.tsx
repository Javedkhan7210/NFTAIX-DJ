import { ReactNode, useEffect, useMemo, useState } from "react";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { AdminChainPage } from "./AdminChainPage";
import { AdminContentPage } from "./AdminContentPage";
import { AdminEconomyPage } from "./AdminEconomyPage";
import { AdminNftsPage } from "./AdminNftsPage";
import { AdminUsersPage } from "./AdminUsersPage";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <h2 className="text-base font-bold tracking-tight text-white">{title}</h2>
      {children}
    </section>
  );
}

export function AdminSuperControlCenter() {
  const [active, setActive] = useState<"overview" | "content" | "users" | "economy" | "nfts" | "chain">("overview");
  const [notice, setNotice] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    users: number;
    blockedUsers: number;
    rewardKeys: number;
    nftRecords: number;
    recentActions: number;
    activeAutoTradeBots: number;
  }>({
    users: 0,
    blockedUsers: 0,
    rewardKeys: 0,
    nftRecords: 0,
    recentActions: 0,
    activeAutoTradeBots: 0
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setNotice(null);
      try {
        const res = await adminService.stats();
        if (cancelled) return;
        const s = res.data;
        setMetrics({
          users: s.totalUsers,
          blockedUsers: s.blockedUsers,
          rewardKeys: s.rewardSettings,
          nftRecords: s.nftRecords,
          recentActions: s.recentAdminActions,
          activeAutoTradeBots: s.activeAutoTradeBots
        });
      } catch (e) {
        if (!cancelled) setNotice(getApiErrorMessage(e, "Could not load dashboard summary metrics."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sidebar = useMemo(
    () =>
      [
        ["overview", "Dashboard"],
        ["content", "User Dashboard Controls"],
        ["users", "User Management"],
        ["economy", "Income and Subscription"],
        ["nfts", "NFT and Transactions"],
        ["chain", "Wallet Bot and Chain"]
      ] as const,
    []
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="neon-card h-fit space-y-2 p-3 lg:sticky lg:top-4">
        <p className="label-caps mb-2">Super Admin</p>
        {sidebar.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
              active === id
                ? "bg-[#22E6A0]/20 font-semibold text-[#22E6A0]"
                : "text-[#8b9bb4] hover:bg-white/10 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </aside>

      <div className="space-y-4">
        {notice ? (
          <p className="rounded-xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">{notice}</p>
        ) : null}

        {active === "overview" ? (
          <Section title="Dashboard Summary">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="neon-card neon-card--inner p-4">
                <p className="label-caps">Total users</p>
                <p className="mt-1 text-2xl font-bold text-white">{metrics.users}</p>
              </div>
              <div className="neon-card neon-card--inner p-4">
                <p className="label-caps">Blocked users</p>
                <p className="mt-1 text-2xl font-bold text-amber-200">{metrics.blockedUsers}</p>
              </div>
              <div className="neon-card neon-card--inner p-4">
                <p className="label-caps">Active auto-trade bots</p>
                <p className="mt-1 text-2xl font-bold text-[#22E6A0]">{metrics.activeAutoTradeBots}</p>
              </div>
              <div className="neon-card neon-card--inner p-4">
                <p className="label-caps">Income keys</p>
                <p className="mt-1 text-2xl font-bold text-white">{metrics.rewardKeys}</p>
              </div>
              <div className="neon-card neon-card--inner p-4">
                <p className="label-caps">NFT records</p>
                <p className="mt-1 text-2xl font-bold text-white">{metrics.nftRecords}</p>
              </div>
              <div className="neon-card neon-card--inner p-4">
                <p className="label-caps">Admin logs (7d)</p>
                <p className="mt-1 text-2xl font-bold text-white">{metrics.recentActions}</p>
              </div>
            </div>
          </Section>
        ) : null}

        {active === "content" ? (
          <Section title="1) User Dashboard Controls">
            <AdminContentPage />
          </Section>
        ) : null}
        {active === "users" ? (
          <Section title="2) User Management Controls">
            <AdminUsersPage />
          </Section>
        ) : null}
        {active === "economy" ? (
          <Section title="3) Income and Subscription Management">
            <AdminEconomyPage />
          </Section>
        ) : null}
        {active === "nfts" ? (
          <Section title="4) NFT and Transaction Monitoring">
            <AdminNftsPage />
          </Section>
        ) : null}
        {active === "chain" ? (
          <Section title="5) Wallet Bot and Chain Controls">
            <AdminChainPage />
          </Section>
        ) : null}
      </div>
    </div>
  );
}
