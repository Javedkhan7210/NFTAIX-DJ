import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { MobileShell } from "../components/MobileShell";
import { IncomeHeroSkeleton } from "../components/SkeletonLoaders";
import { SubScreenHeader } from "../components/SubScreenHeader";
import { ExplorerTxLink } from "../components/ExplorerTxLink";
import { formatMoney, parseIncomeAmount, sumIncomeAmount } from "../lib/formatCrypto";
import { incomeService } from "../services/incomeService";

function IconDirect({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M24 8c-4.5 0-8 3.6-8 8v6c0 4.4 3.6 8 8 8s8-3.6 8-8v-6c0-4.4-3.5-8-8-8z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M16 36c0 4 3.6 7 8 7s8-3 8-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M24 22v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconSublevel({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path d="M8 38h32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 30h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 22h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 14h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M24 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconNftLevel({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect x="10" y="14" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M10 22h28" stroke="currentColor" strokeWidth="2" />
      <path d="M18 14V10M30 14V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 28h6M26 28h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconTradingLevel({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path d="M8 36V20l8 8 8-12 8 6 8-10v24H8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 12l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconGlobal({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle cx="24" cy="24" r="14" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 24h28M24 10c4 6 4 22 0 28M24 10c-4 6-4 22 0 28"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAirdrop({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M24 8l3 8h8l-6 5 2 9-7-5-7 5 2-9-6-5h8l3-8z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <ellipse cx="24" cy="34" rx="10" ry="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const HISTORY_TYPE_LABELS: Record<string, string> = {
  direct: "Direct income",
  team: "Sublevel income",
  network: "Sublevel income",
  level: "Sublevel income",
  nft: "Trading income",
  nft_level: "NFT level income",
  global_pool: "Global income",
  other: "Token airdrop / other"
};

function incomeTransactionTitle(incomeType: string): string {
  return HISTORY_TYPE_LABELS[incomeType] ?? `Income · ${incomeType}`;
}

type HistoryFilterTab =
  | "all"
  | "sublevel"
  | "global_pool"
  | "direct"
  | "nft"
  | "nft_level";

const HISTORY_FILTER_TABS: { id: HistoryFilterTab; label: string; title: string }[] = [
  { id: "all", label: "All", title: "All income types" },
  { id: "sublevel", label: "Sublevel", title: "Sublevel income" },
  { id: "global_pool", label: "Global", title: "Global income" },
  { id: "direct", label: "Direct", title: "Direct income" },
  { id: "nft", label: "Trading", title: "Trading income" },
  { id: "nft_level", label: "NFT level", title: "NFT level income" }
];

function normalizeIncomeType(raw: unknown): string {
  const s = String(raw ?? "other").trim().toLowerCase();
  return s.length > 0 ? s : "other";
}

function historyMatchesFilter(incomeType: string, tab: HistoryFilterTab): boolean {
  const type = normalizeIncomeType(incomeType);
  if (tab === "all") return true;
  if (tab === "sublevel") return ["team", "network", "level"].includes(type);
  return type === tab;
}

type IncomeGridRow = { amount: string | number; status: string; incomeType: string; lockedUntil?: string };

type HistoryRow = IncomeGridRow & {
  id: string;
  createdAt: string;
  historyKind?: "ledger" | "nft_level";
  sourcePublicNumber?: number | null;
  sourceReferralCode?: string | null;
  sourceActivationTxHash?: string | null;
  txHash?: string | null;
  tokenId?: string | null;
  treeLine?: number | null;
};

function moneyOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeIncomeRows(raw: unknown[]): IncomeGridRow[] {
  return raw.map((r) => {
    const row = r as { amount?: unknown; status?: string; incomeType?: string; lockedUntil?: string };
    return {
      amount: parseIncomeAmount(row.amount),
      status: String(row.status ?? ""),
      incomeType: normalizeIncomeType(row.incomeType),
      lockedUntil: row.lockedUntil ? String(row.lockedUntil) : undefined
    };
  });
}

function IncomeOverviewBox({
  title,
  subtitle,
  value,
  icon,
  loading
}: {
  title: string;
  subtitle?: React.ReactNode;
  value: string;
  icon: ReactNode;
  loading?: boolean;
}) {
  return (
    <motion.div
      className="neon-card neon-card--inner flex flex-col gap-2 p-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-left">
          <p className="text-[10px] font-bold uppercase leading-tight tracking-wide text-[#8b9bb4]">{title}</p>
          {subtitle ? (
            <div className="mt-0.5 text-[9px] font-medium text-[#6b7d94] [&_span.block]:leading-snug">{subtitle}</div>
          ) : null}
        </div>
        <span className="shrink-0 text-[#22E6A0]">{icon}</span>
      </div>
      <p className="font-mono text-lg font-bold leading-tight text-[#22E6A0]">{loading ? "…" : value}</p>
    </motion.div>
  );
}

export function IncomePage() {
  const location = useLocation();
  const [rows, setRows] = useState<IncomeGridRow[]>([]);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterTab>("all");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [registrationRewardSummary, setRegistrationRewardSummary] = useState<{
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
    holdNftAmountUsdt: number;
    totalSpentUsdt: number;
    incomeFromPackageUsdt: number;
    tradingIncomeFromPackageUsdt: number;
    currentPackageActivationUsdt?: number;
    tokenAirdropScore?: number;
  } | null>(null);
  const [nftTradingExtra, setNftTradingExtra] = useState<{
    extraEarned: number;
    todayExtraEarned: number;
  } | null>(null);
  /** `/registration-reward-summary` — trading + token airdrop + today slice; independent of `/nft-extra-earned`. */
  const [registrationRewardLoading, setRegistrationRewardLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setRegistrationRewardLoading(true);
    setHistoryLoading(true);

    void (async () => {
      try {
        const res = await incomeService.wallet();
        if (cancelled) return;
        const data = res.data as {
          total?: unknown[];
          unlocked?: unknown[];
          locked?: unknown[];
          burned?: unknown[];
        };
        const merged = [...(data.unlocked ?? []), ...(data.locked ?? []), ...(data.burned ?? [])];
        const source = Array.isArray(data.total) ? data.total : merged;
        setRows(normalizeIncomeRows(source));

        const historyRes = await incomeService.history();
        if (cancelled) return;
        const raw = Array.isArray(historyRes.data) ? historyRes.data : [];
        const list: HistoryRow[] = raw.map((h) => {
          const row = h as {
            id: string;
            createdAt: string;
            amount?: unknown;
            status?: string;
            incomeType?: string;
            historyKind?: "ledger" | "nft_level";
            sourcePublicNumber?: number | null;
            sourceReferralCode?: string | null;
            sourceActivationTxHash?: string | null;
            txHash?: string | null;
            tokenId?: string | null;
            treeLine?: number | null;
          };
          return {
            id: row.id,
            createdAt: row.createdAt,
            amount: parseIncomeAmount(row.amount),
            status: String(row.status ?? ""),
            incomeType: normalizeIncomeType(row.incomeType),
            historyKind: row.historyKind,
            sourcePublicNumber: row.sourcePublicNumber ?? null,
            sourceReferralCode: row.sourceReferralCode ?? null,
            sourceActivationTxHash: row.sourceActivationTxHash ?? null,
            txHash: row.txHash ?? null,
            tokenId: row.tokenId ?? null,
            treeLine: row.treeLine ?? null
          };
        });
        setHistoryRows(list);
      } catch {
        if (!cancelled) {
          setRows([]);
          setHistoryRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHistoryLoading(false);
        }
      }
    })();

    void incomeService
      .registrationRewardSummary()
      .then((res) => {
        if (cancelled) return;
        const md = res.data as Record<string, unknown> | null | undefined;
        setRegistrationRewardSummary(
          md
            ? {
                directIncome: moneyOrNull(md.directIncome) ?? 0,
                sublevelIncome: moneyOrNull(md.sublevelIncome) ?? 0,
                todayDirectIncome: moneyOrNull(md.todayDirectIncome) ?? 0,
                todaySublevelIncome: moneyOrNull(md.todaySublevelIncome) ?? 0,
                nftLevelIncome: moneyOrNull(md.nftLevelIncome) ?? 0,
                todayNftLevelIncome: moneyOrNull(md.todayNftLevelIncome) ?? 0,
                tradingIncome: moneyOrNull(md.tradingIncome) ?? 0,
                todayTradingIncome: moneyOrNull(md.todayTradingIncome) ?? 0,
                packageTradingVolumeUsdt: moneyOrNull(md.packageTradingVolumeUsdt) ?? 0,
                todayPackageTradingVolumeUsdt: moneyOrNull(md.todayPackageTradingVolumeUsdt) ?? 0,
                holdNftAmountUsdt: moneyOrNull(md.holdNftAmountUsdt) ?? 0,
                totalSpentUsdt: moneyOrNull(md.totalSpentUsdt) ?? 0,
                incomeFromPackageUsdt: moneyOrNull(md.incomeFromPackageUsdt) ?? 0,
                tradingIncomeFromPackageUsdt: moneyOrNull(md.tradingIncomeFromPackageUsdt) ?? 0,
                currentPackageActivationUsdt: moneyOrNull(md.currentPackageActivationUsdt) ?? 0,
                tokenAirdropScore: moneyOrNull(md.tokenAirdropScore) ?? 0
              }
            : null
        );
      })
      .catch(() => {
        if (!cancelled) setRegistrationRewardSummary(null);
      })
      .finally(() => {
        if (!cancelled) setRegistrationRewardLoading(false);
      });

    void incomeService
      .nftExtraEarned()
      .then((res) => {
        if (cancelled) return;
        const d = res.data as { extraEarned?: unknown; todayExtraEarned?: unknown } | undefined;
        setNftTradingExtra(
          d
            ? {
                extraEarned: moneyOrNull(d.extraEarned) ?? 0,
                todayExtraEarned: moneyOrNull(d.todayExtraEarned) ?? 0
              }
            : null
        );
      })
      .catch(() => {
        if (!cancelled) setNftTradingExtra(null);
      });

    return () => {
      cancelled = true;
    };
  }, [location.key]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const todayIncome = useMemo(() => {
    const now = new Date();
    const startUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    const endUtc = startUtc + 86400000;
    const ledgerToday = historyRows.reduce((acc, h) => {
      const t = new Date(h.createdAt).getTime();
      if (t < startUtc || t >= endUtc) return acc;
      if (h.status === "burned") return acc;
      return acc + (parseIncomeAmount(h.amount) || 0);
    }, 0);
    return Math.max(
      ledgerToday,
      (registrationRewardSummary?.todayDirectIncome ?? 0) +
        (registrationRewardSummary?.todaySublevelIncome ?? 0) +
        (registrationRewardSummary?.todayNftLevelIncome ?? 0) +
        Math.max(
          registrationRewardSummary?.todayTradingIncome ?? 0,
          nftTradingExtra?.todayExtraEarned ?? 0
        )
    );
  }, [
    historyRows,
    tick,
    registrationRewardSummary?.todayDirectIncome,
    registrationRewardSummary?.todaySublevelIncome,
    registrationRewardSummary?.todayNftLevelIncome,
    registrationRewardSummary?.todayTradingIncome,
    nftTradingExtra?.todayExtraEarned
  ]);

  const directIncome = useMemo(
    () =>
      Math.max(
        registrationRewardSummary?.directIncome ?? 0,
        sumIncomeAmount(rows, (r) => r.status !== "burned" && r.incomeType === "direct")
      ),
    [rows, registrationRewardSummary?.directIncome]
  );

  const sublevelIncome = useMemo(
    () =>
      Math.max(
        registrationRewardSummary?.sublevelIncome ?? 0,
        sumIncomeAmount(
          rows,
          (r) => r.status !== "burned" && ["level", "team", "network"].includes(r.incomeType)
        )
      ),
    [rows, registrationRewardSummary?.sublevelIncome]
  );

  const nftLevelIncome = useMemo(
    () =>
      Math.max(
        registrationRewardSummary?.nftLevelIncome ?? 0,
        sumIncomeAmount(rows, (r) => r.status !== "burned" && r.incomeType === "nft_level")
      ),
    [rows, registrationRewardSummary?.nftLevelIncome]
  );

  const tradingIncome = useMemo(
    () =>
      Math.max(
        registrationRewardSummary?.tradingIncome ?? 0,
        nftTradingExtra?.extraEarned ?? 0,
        sumIncomeAmount(rows, (r) => r.status !== "burned" && r.incomeType === "nft")
      ),
    [rows, registrationRewardSummary?.tradingIncome, nftTradingExtra?.extraEarned]
  );

  const globalIncome = useMemo(
    () => sumIncomeAmount(rows, (r) => r.status !== "burned" && r.incomeType === "global_pool"),
    [rows]
  );

  const earnedTotal = useMemo(
    () => directIncome + sublevelIncome + nftLevelIncome + tradingIncome + globalIncome,
    [directIncome, sublevelIncome, nftLevelIncome, tradingIncome, globalIncome]
  );

  const tokenAirdropIncome = useMemo(
    () => sumIncomeAmount(rows, (r) => r.status !== "burned" && r.incomeType === "other"),
    [rows]
  );

  const filteredHistoryRows = useMemo(
    () => historyRows.filter((h) => historyMatchesFilter(h.incomeType, historyFilter)),
    [historyRows, historyFilter]
  );

  const historyFilterBtn = (id: HistoryFilterTab, label: string, title: string) => {
    const on = historyFilter === id;
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={on}
        title={title}
        onClick={() => setHistoryFilter(id)}
        className={
          on
            ? "tab-pill tab-pill--active w-full rounded-xl px-2 py-2.5 text-center text-[11px] font-semibold leading-tight sm:text-xs"
            : "w-full rounded-xl border border-[rgba(0,198,255,0.45)] bg-transparent px-2 py-2.5 text-center text-[11px] font-semibold leading-tight text-[#8b9bb4] shadow-[0_0_12px_rgba(123,47,247,0.15)] sm:text-xs"
        }
      >
        {label}
      </button>
    );
  };

  return (
    <MobileShell>
      <SubScreenHeader />

      <main className="flex flex-col gap-4">
        <motion.section
          className="neon-card p-5 text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {loading ? (
            <IncomeHeroSkeleton />
          ) : (
            <>
              <p className="label-caps mb-2">Total Income</p>
              <p className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{formatMoney(earnedTotal)}</p>
              <p className="mt-2 text-xs font-semibold text-[#8b9bb4]">
                Today Income:{" "}
                {registrationRewardLoading ? (
                  <span className="font-mono text-white/50">…</span>
                ) : (
                  <span className="font-mono text-white/90">{formatMoney(todayIncome)} USDT</span>
                )}
              </p>
            </>
          )}
        </motion.section>

        <section>
          <p className="label-caps mb-2 px-0.5">Income</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <IncomeOverviewBox
              title="Direct income"
              value={formatMoney(directIncome)}
              icon={<IconDirect />}
              loading={loading}
            />
            <IncomeOverviewBox
              title="Sublevel income"
              subtitle={<span className="block">From package activations in your team</span>}
              value={formatMoney(sublevelIncome)}
              icon={<IconSublevel />}
              loading={loading}
            />
            <IncomeOverviewBox
              title="NFT level income"
              value={formatMoney(nftLevelIncome)}
              icon={<IconNftLevel />}
              loading={loading || registrationRewardLoading}
            />
            <IncomeOverviewBox
              title="Trading income"
              value={`${formatMoney(tradingIncome)} USDT`}
              icon={<IconTradingLevel />}
              loading={loading || registrationRewardLoading}
            />
            <IncomeOverviewBox
              title="Global income"
              value={formatMoney(globalIncome)}
              icon={<IconGlobal />}
              loading={loading}
            />
            <IncomeOverviewBox
              title="Token airdrop"
              value={`${formatMoney(
                registrationRewardSummary != null
                  ? (registrationRewardSummary.tokenAirdropScore ?? 0)
                  : tokenAirdropIncome,
                ""
              )} AIX`}
              icon={<IconAirdrop />}
              loading={loading || registrationRewardLoading}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-0.5">
            <p className="label-caps">Transaction history</p>
            {!historyLoading && historyRows.length > 0 ? (
              <p className="text-[11px] font-medium text-[#6b7d94]">
                {filteredHistoryRows.length} of {historyRows.length}
              </p>
            ) : null}
          </div>
          {!historyLoading && historyRows.length > 0 ? (
            <div
              className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="tablist"
              aria-label="Filter transaction history"
            >
              {HISTORY_FILTER_TABS.map(({ id, label, title }) => historyFilterBtn(id, label, title))}
            </div>
          ) : null}
          {historyLoading ? (
            <p className="text-sm text-[#8b9bb4]">Loading history…</p>
          ) : historyRows.length === 0 ? (
            <p className="text-sm text-[#8b9bb4]">No income transactions yet.</p>
          ) : filteredHistoryRows.length === 0 ? (
            <p className="text-sm text-[#8b9bb4]">
              No{" "}
              {HISTORY_FILTER_TABS.find((t) => t.id === historyFilter)?.title.toLowerCase() ?? "matching"}{" "}
              transactions yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {filteredHistoryRows.map((h, i) => (
            <motion.li
              key={`${h.historyKind ?? "ledger"}-${h.id}`}
              className="neon-card neon-card--inner p-4"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold leading-snug text-white">
                        {incomeTransactionTitle(h.incomeType)}
                      </p>
                      {h.incomeType === "nft_level" && h.tokenId != null ? (
                        <p className="mt-1 text-xs text-[#8b9bb4]">
                          NFT #{h.tokenId}
                          {h.treeLine != null ? (
                            <>
                              {" "}
                              · level <span className="font-mono text-white/85">{h.treeLine}</span>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {h.sourceReferralCode || h.sourcePublicNumber != null ? (
                        <p className="mt-1 text-xs text-[#8b9bb4]">
                          From referral{" "}
                          {h.sourceReferralCode ? (
                            <span className="font-mono text-white/85">{h.sourceReferralCode}</span>
                          ) : (
                            <span className="font-mono text-white/85">#{h.sourcePublicNumber}</span>
                          )}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8b9bb4]">Recorded</p>
                        <p className="font-mono text-xs text-white/90">
                          {new Date(h.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 self-center text-right">
                      <p className="font-mono text-sm font-bold text-[#22E6A0]">
                        {formatMoney(parseIncomeAmount(h.amount), "")}{" "}
                        {h.incomeType === "other" ? "AIX" : "USDT"}
                      </p>
                      {h.txHash || h.sourceActivationTxHash ? (
                        <p className="mt-1 text-xs text-[#8b9bb4]">
                          <ExplorerTxLink
                            txHash={(h.txHash ?? h.sourceActivationTxHash)!}
                            className="font-mono text-[#00D1FF] underline"
                          />
                        </p>
                      ) : null}
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </MobileShell>
  );
}
