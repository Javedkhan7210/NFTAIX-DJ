import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MobileShell } from "../components/MobileShell";
import { TeamsMemberRowSkeleton, TeamsSubscriptionSkeleton } from "../components/SkeletonLoaders";
import { SubScreenHeader } from "../components/SubScreenHeader";
import { ExplorerTxLink } from "../components/ExplorerTxLink";
import { WalletAddressWithCopy } from "../components/WalletAddressWithCopy";
import { formatMoney } from "../lib/formatCrypto";
import { opbnbExplorerTx } from "../lib/opbnb";
import { syncPackageActivationIfNeeded } from "../lib/syncPackageActivation";
import { getUserFacingError } from "../lib/getUserFacingError";
import { userService, type BlockchainActivityDto } from "../services/userService";

const teamFilters = ["MY Direct", "My Team", "Global Team", "Level Details", "Subscription Details"] as const;

type FilterId = (typeof teamFilters)[number];

type ReferralRow = {
  id: string;
  directReferralCount?: number;
  teamCount?: number;
  createdAt: string;
  registrationTxHash?: string | null;
  walletConnections?: { walletAddress: string }[];
  earnedUsdt?: string | number;
  earnedDirectUsdt?: string | number;
  earnedDirectReceivedUsdt?: string | number;
  revenueUsdt?: string | number;
  /** true = met today's required volume; false = miss; null = no package */
  todayTradingActive?: boolean | null;
};

type TeamEdge = {
  referralId: string;
  walletAddress: string | null;
  registrationTxHash?: string | null;
  level: number;
  createdAt: string;
  earnedUsdt?: string | number;
  revenueUsdt?: string | number;
  todayTradingActive?: boolean | null;
};

type UiRow = {
  key: string;
  addressFull: string | null;
  date: string;
  amount: string;
  registrationTxHash: string | null;
  todayTradingActive: boolean | null;
};

/** Accepts a stored registration tx hash when it looks like a hex tx id. */
function registrationTxForExplorer(h: string | null | undefined): string | null {
  const s = (h ?? "").trim();
  if (!/^0x[a-fA-F0-9]+$/i.test(s) || s.length < 18) return null;
  return s;
}

type ProfileStats = { directReferralCount: number; teamCount: number };

function IconTrophy() {
  return (
    <span className="text-2xl leading-none sm:text-3xl" aria-hidden>
      🏆
    </span>
  );
}

function AvatarPlaceholder({ seed }: { seed: number }) {
  const hue = (seed * 47) % 360;
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 text-lg"
      style={{ background: `linear-gradient(135deg, hsl(${hue},55%,42%), hsl(${(hue + 40) % 360},50%,28%))` }}
      aria-hidden
    >
      🐹
    </div>
  );
}

function IconCoinStack() {
  return (
    <span className="text-xl" aria-hidden>
      💰
    </span>
  );
}

export function TeamsPage() {
  const [activeFilter, setActiveFilter] = useState<FilterId>("MY Direct");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [directs, setDirects] = useState<ReferralRow[]>([]);
  const [globalTeam, setGlobalTeam] = useState<ReferralRow[]>([]);
  const [edges, setEdges] = useState<TeamEdge[]>([]);
  const [subscriptions, setSubscriptions] = useState<BlockchainActivityDto["subscriptions"]>([]);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const subscriptionTxHash = (s: BlockchainActivityDto["subscriptions"][number]): string | null => {
    const h = (s.chainTxHash ?? s.txHash ?? "").trim();
    return h ? h : null;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await userService.profile();
        const u = res.data as { directReferralCount?: number; teamCount?: number };
        if (!cancelled) {
          setProfile({
            directReferralCount: Number(u.directReferralCount ?? 0),
            teamCount: Number(u.teamCount ?? 0)
          });
        }
      } catch {
        if (!cancelled) setProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [activeFilter]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        if (activeFilter === "MY Direct") {
          const res = await userService.referrals();
          if (!cancelled) setDirects((res.data as ReferralRow[]) ?? []);
          setGlobalTeam([]);
          setEdges([]);
          setSubscriptions([]);
        } else if (activeFilter === "My Team" || activeFilter === "Level Details") {
          const res = await userService.team();
          const data = res.data as { edges?: TeamEdge[] };
          if (!cancelled) setEdges(data.edges ?? []);
          setDirects([]);
          setGlobalTeam([]);
          setSubscriptions([]);
        } else if (activeFilter === "Global Team") {
          const res = await userService.globalTeam();
          if (!cancelled) setGlobalTeam((res.data as ReferralRow[]) ?? []);
          setDirects([]);
          setEdges([]);
          setSubscriptions([]);
        } else if (activeFilter === "Subscription Details") {
          await syncPackageActivationIfNeeded();
          const res = await userService.blockchainActivity();
          if (!cancelled) setSubscriptions(res.data.subscriptions ?? []);
          setDirects([]);
          setGlobalTeam([]);
          setEdges([]);
        }
      } catch (e) {
        if (!cancelled) {
          setDirects([]);
          setGlobalTeam([]);
          setEdges([]);
          setSubscriptions([]);
          setLoadError(getUserFacingError(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeFilter]);

  const edgesSortedByLevel = useMemo(() => {
    return [...edges].sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [edges]);

  const edgeSource = activeFilter === "Level Details" ? edgesSortedByLevel : edges;

  const hasWalletAddress = (addr: string | null | undefined) => /^0x[a-fA-F0-9]{40}$/.test((addr ?? "").trim());

  const formatDateTimeOrBlank = (d: string | null | undefined) => {
    const t = new Date((d ?? "").trim()).getTime();
    if (!Number.isFinite(t)) return "";
    return new Date(t).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  };

  const rows: UiRow[] = useMemo(() => {
    if (activeFilter === "MY Direct") {
      return directs
        .map((u) => ({
          key: u.id,
          addressFull: u.walletConnections?.[0]?.walletAddress ?? null,
          date: formatDateTimeOrBlank(u.createdAt),
          amount: formatMoney(
            // Show total profit earned from this user (all income types sourced from them).
            Number(u.earnedUsdt ?? u.revenueUsdt ?? u.earnedDirectReceivedUsdt ?? u.earnedDirectUsdt ?? 0)
          ),
          registrationTxHash: u.registrationTxHash ?? null,
          todayTradingActive: u.todayTradingActive ?? null
        }))
        .filter((r) => hasWalletAddress(r.addressFull));
    }
    if (activeFilter === "Global Team") {
      const sorted = [...globalTeam].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const total = sorted.length;
      return sorted
        .map((u, idx) => ({
          key: u.id,
          addressFull: u.walletConnections?.[0]?.walletAddress ?? null,
          date: formatDateTimeOrBlank(u.createdAt),
          amount: String(Math.max(0, total - 1 - idx)),
          registrationTxHash: u.registrationTxHash ?? null,
          todayTradingActive: u.todayTradingActive ?? null
        }))
        .filter((r) => hasWalletAddress(r.addressFull));
    }
    if (activeFilter === "My Team" || activeFilter === "Level Details") {
      return edgeSource
        .map((e, i) => ({
          key: `${e.referralId}-${i}`,
          addressFull: e.walletAddress,
          date: formatDateTimeOrBlank(e.createdAt),
          amount: activeFilter === "My Team" ? formatMoney(Number(e.earnedUsdt ?? e.revenueUsdt ?? 0)) : `L${e.level}`,
          registrationTxHash: e.registrationTxHash ?? null,
          todayTradingActive: e.todayTradingActive ?? null
        }))
        .filter((r) => hasWalletAddress(r.addressFull));
    }
    return [];
  }, [activeFilter, directs, edgeSource, formatDateTimeOrBlank, globalTeam]);

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * perPage, safePage * perPage);

  const subscriptionPages = Math.max(1, Math.ceil(subscriptions.length / perPage));
  const safeSubPage = Math.min(page, subscriptionPages);
  const pageSubs = subscriptions.slice((safeSubPage - 1) * perPage, safeSubPage * perPage);

  const showMemberList =
    activeFilter === "MY Direct" || activeFilter === "My Team" || activeFilter === "Global Team" || activeFilter === "Level Details";

  return (
    <MobileShell>
      <SubScreenHeader />

      <div className="mb-4 flex items-center gap-2">
        <IconTrophy />
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Teams</h1>
      </div>

      {profile ? (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="neon-card neon-card--inner p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8b9bb4]">Direct referrals</p>
            <p className="mt-1 text-xl font-bold text-white">{profile.directReferralCount}</p>
          </div>
          <div className="neon-card neon-card--inner p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8b9bb4]">Team size</p>
            <p className="mt-1 text-xl font-bold text-white">{profile.teamCount}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {teamFilters.map((f) => {
          const active = activeFilter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFilter(f)}
              className={`rounded-xl px-3 py-2 text-left text-xs font-semibold sm:text-[13px] ${active ? "tab-pill tab-pill--active" : "border border-white/15 bg-transparent text-[#8b9bb4]"}`}
            >
              {f}
            </button>
          );
        })}
      </div>

      <main className="flex flex-col gap-3">
        {activeFilter === "Subscription Details" ? (
          <>
            {loading ? <TeamsSubscriptionSkeleton /> : null}
            {!loading &&
              pageSubs.map((s, i) => (
                <motion.div
                  key={s.id}
                  className="neon-card neon-card--inner flex flex-col gap-2 p-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-white">{s.tierName}</p>
                      <p className="font-mono text-xs text-[#22E6A0]">{formatMoney(Number(s.tierAmount))}</p>
                    </div>
                    <span className="rounded-lg bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase text-[#a8b8c8]">
                      {s.onChain ? "On-chain" : "Off-chain"}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8b9bb4]">
                    Activated {new Date(s.activatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  {subscriptionTxHash(s) ? (
                    <a
                      href={opbnbExplorerTx(subscriptionTxHash(s)!)}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-xs font-medium text-[#00D1FF] underline-offset-2 hover:underline"
                    >
                      View tx
                    </a>
                  ) : null}
                </motion.div>
              ))}
            {subscriptions.length > perPage ? (
              <div className="neon-card neon-card--inner mt-2 flex flex-wrap items-center justify-center gap-2 p-3">
                <motion.button
                  type="button"
                  className="tab-pill tab-pill--active flex h-9 w-9 items-center justify-center rounded-lg p-0 text-lg font-bold"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  whileTap={{ scale: 0.95 }}
                  aria-label="Previous page"
                >
                  ‹
                </motion.button>
                <span className="tab-pill tab-pill--active flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-2 text-sm font-bold">
                  {safeSubPage} / {subscriptionPages}
                </span>
                <motion.button
                  type="button"
                  className="tab-pill tab-pill--active flex h-9 w-9 items-center justify-center rounded-lg p-0 text-lg font-bold"
                  onClick={() => setPage((p) => Math.min(subscriptionPages, p + 1))}
                  whileTap={{ scale: 0.95 }}
                  aria-label="Next page"
                >
                  ›
                </motion.button>
              </div>
            ) : null}
          </>
        ) : null}

        {showMemberList ? (
          <>
            {loading ? <TeamsMemberRowSkeleton rows={5} /> : null}

            {!loading && loadError ? (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {loadError}
              </p>
            ) : null}

            {!loading && !loadError && rows.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-6 text-center text-sm text-[#8b9bb4]">
                No Data Found
              </p>
            ) : null}

            {pageRows.map((row, i) => {
              const regTx = registrationTxForExplorer(row.registrationTxHash);
              return (
                <motion.div
                  key={row.key}
                  className="neon-card flex items-center gap-3 p-3 sm:p-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <AvatarPlaceholder seed={i + safePage * 10} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <WalletAddressWithCopy addressFull={row.addressFull} emptyLabel="" />
                      {activeFilter !== "Global Team" && activeFilter !== "Level Details" ? (
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            row.todayTradingActive === true
                              ? "bg-[#22E6A0]/15 text-[#22E6A0]"
                              : "bg-white/10 text-[#8b9bb4]"
                          }`}
                          title="Active = met today's required trading volume (temporary)"
                        >
                          {row.todayTradingActive === true ? "Active" : "Inactive"}
                        </span>
                      ) : null}
                    </div>
                    {row.date ? <p className="mt-1 text-[11px] text-[#8b9bb4]">{row.date}</p> : null}
                    {regTx ? (
                      <>
                        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#8b9bb4]">
                          Registration tx
                        </p>
                        <ExplorerTxLink
                          txHash={regTx}
                          showHash={false}
                          className="mt-0.5 inline-block text-xs font-semibold text-[#00D1FF] underline-offset-2 hover:underline"
                        />
                      </>
                    ) : null}
                  </div>
                  {row.amount ? (
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <IconCoinStack />
                      <span
                        className="text-lg font-bold text-[#f6d365]"
                        title={
                          activeFilter === "Level Details"
                            ? "Package level"
                            : activeFilter === "Global Team"
                              ? "Users who joined after this user"
                              : "Your earnings from this user (USDT)"
                        }
                      >
                        {row.amount}
                      </span>
                      {activeFilter === "Level Details" ? (
                        <span className="text-[9px] uppercase text-[#8b9bb4]">level</span>
                      ) : activeFilter === "Global Team" ? (
                        <span className="text-[9px] uppercase text-[#8b9bb4]">joined after</span>
                      ) : (
                        <span className="text-[9px] uppercase text-[#8b9bb4]">earnings</span>
                      )}
                    </div>
                  ) : null}
                </motion.div>
              );
            })}

            {rows.length > 0 ? (
              <div className="neon-card neon-card--inner mt-2 flex flex-wrap items-center justify-center gap-2 p-3 sm:justify-between">
                <label className="flex items-center gap-2 text-xs text-[#8b9bb4]">
                  <span className="sr-only">Rows per page</span>
                  <select
                    value={perPage}
                    onChange={(e) => {
                      setPerPage(Number(e.target.value));
                      setPage(1);
                    }}
                    className="rounded-lg border border-white/15 bg-transparent px-2 py-1.5 text-sm font-medium text-white"
                  >
                    {[10, 25, 50].map((n) => (
                      <option key={n} value={n} className="bg-[#0b0f1a]">
                        {n} / page
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <motion.button
                    type="button"
                    className="tab-pill tab-pill--active flex h-9 w-9 items-center justify-center rounded-lg p-0 text-lg font-bold"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    whileTap={{ scale: 0.95 }}
                    aria-label="Previous page"
                  >
                    ‹
                  </motion.button>
                  <span className="tab-pill tab-pill--active flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-2 text-sm font-bold">
                    {safePage} / {totalPages}
                  </span>
                  <motion.button
                    type="button"
                    className="tab-pill tab-pill--active flex h-9 w-9 items-center justify-center rounded-lg p-0 text-lg font-bold"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    whileTap={{ scale: 0.95 }}
                    aria-label="Next page"
                  >
                    ›
                  </motion.button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </MobileShell>
  );
}
