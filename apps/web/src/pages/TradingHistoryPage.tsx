import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { MarketQuadNav } from "../components/MarketQuadNav";
import { TradingHistorySkeleton } from "../components/SkeletonLoaders";
import { MarketTopBar } from "../components/MarketTopBar";
import { MobileShell } from "../components/MobileShell";
import { SubScreenHeader } from "../components/SubScreenHeader";
import { getUserFacingError } from "../lib/getUserFacingError";
import { formatMoney } from "../lib/formatCrypto";
import { syncPackageActivationIfNeeded } from "../lib/syncPackageActivation";
import { ExplorerTxLink } from "../components/ExplorerTxLink";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { emptyPaginated, mergePaginated, type Paginated } from "../lib/pagination";
import { tradingService } from "../services/tradingService";
import { nftService, type NftHistoryOwnership } from "../services/nftService";
import { usePollingWhileVisible } from "../lib/usePollingWhileVisible";

const HISTORY_PAGE_SIZE = 20;

type ComplianceRow = {
  id: string;
  day: string;
  requiredVolume: string | number;
  achievedVolume: string | number;
  status: "compliant" | "non_compliant" | "inactive";
  consecutiveMiss: number;
};

type VolumeLogRow = {
  id: string;
  tradeDate: string;
  volume: number;
  allowedDailyVolume: number;
  tierName: string;
  chainTxHash: string | null;
  relatedTokenId: string | null;
};

type UnifiedVolumeRow =
  | ({ rowKind: "volume" } & VolumeLogRow)
  | {
      rowKind: "nft_sale";
      id: string;
      tradeDate: string;
      volume: number;
      tokenId: string;
      chainTxHash: string;
    };

function vol(v: string | number): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

type HistoryFilter = "all" | "compliant" | "non_compliant" | "inactive";

export function TradingHistoryPage() {
  const navigate = useNavigate();
  const [compliancePage, setCompliancePage] = useState<Paginated<ComplianceRow>>(() =>
    emptyPaginated(HISTORY_PAGE_SIZE)
  );
  const [volumePage, setVolumePage] = useState<Paginated<VolumeLogRow>>(() =>
    emptyPaginated(HISTORY_PAGE_SIZE)
  );
  const [nftOwnershipPage, setNftOwnershipPage] = useState<Paginated<NftHistoryOwnership>>(() =>
    emptyPaginated(HISTORY_PAGE_SIZE)
  );
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMoreVolume, setLoadingMoreVolume] = useState(false);
  const [loadingMoreCompliance, setLoadingMoreCompliance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const volumePageNumRef = useRef(1);
  const nftPageNumRef = useRef(1);
  const compliancePageNumRef = useRef(1);

  const loadTradingHistory = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      await syncPackageActivationIfNeeded();
      const [complianceResult, logsResult, nftHistResult] = await Promise.allSettled([
        tradingService.complianceHistory({ page: 1, limit: HISTORY_PAGE_SIZE }),
        tradingService.volumeLogs({ page: 1, limit: HISTORY_PAGE_SIZE }),
        nftService.history({ page: 1, limit: HISTORY_PAGE_SIZE })
      ]);
      volumePageNumRef.current = 1;
      nftPageNumRef.current = 1;
      compliancePageNumRef.current = 1;
      if (complianceResult.status === "fulfilled") {
        const p = complianceResult.value.data;
        setCompliancePage({
          items: (p.items ?? []) as ComplianceRow[],
          page: p.page,
          limit: p.limit,
          total: p.total,
          hasMore: p.hasMore
        });
      } else if (!opts?.silent) {
        setCompliancePage(emptyPaginated(HISTORY_PAGE_SIZE));
      }
      if (logsResult.status === "fulfilled") {
        const p = logsResult.value.data;
        setVolumePage({
          items: (p.items ?? []).map((x) => ({
            id: String(x.id),
            tradeDate: String(x.tradeDate),
            volume: Number(x.volume),
            allowedDailyVolume: Number(x.allowedDailyVolume),
            tierName: String(x.tierName),
            chainTxHash: x.chainTxHash ?? null,
            relatedTokenId: x.relatedTokenId ?? null
          })),
          page: p.page,
          limit: p.limit,
          total: p.total,
          hasMore: p.hasMore
        });
      } else if (!opts?.silent) {
        setVolumePage(emptyPaginated(HISTORY_PAGE_SIZE));
      }
      if (nftHistResult.status === "fulfilled") {
        setNftOwnershipPage(nftHistResult.value.data?.ownership ?? emptyPaginated(HISTORY_PAGE_SIZE));
      } else if (!opts?.silent) {
        setNftOwnershipPage(emptyPaginated(HISTORY_PAGE_SIZE));
      }
      if (!opts?.silent) {
        if (
          complianceResult.status === "rejected" ||
          logsResult.status === "rejected" ||
          nftHistResult.status === "rejected"
        ) {
          const reason =
            (complianceResult.status === "rejected" && complianceResult.reason) ||
            (logsResult.status === "rejected" && logsResult.reason) ||
            (nftHistResult.status === "rejected" && nftHistResult.reason);
          setError(getUserFacingError(reason));
        }
      }
    } catch (err) {
      if (!opts?.silent) setError(getUserFacingError(err));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTradingHistory();
  }, [loadTradingHistory]);

  usePollingWhileVisible(() => loadTradingHistory({ silent: true }), 15_000, true);

  const loadMoreVolume = useCallback(async () => {
    if (loadingMoreVolume) return;
    setLoadingMoreVolume(true);
    try {
      const tasks: Promise<void>[] = [];
      if (volumePage.hasMore) {
        const next = volumePageNumRef.current + 1;
        tasks.push(
          tradingService.volumeLogs({ page: next, limit: HISTORY_PAGE_SIZE }).then((res) => {
            volumePageNumRef.current = next;
            const p = res.data;
            setVolumePage((prev) =>
              mergePaginated(prev, {
                items: (p.items ?? []).map((x) => ({
                  id: String(x.id),
                  tradeDate: String(x.tradeDate),
                  volume: Number(x.volume),
                  allowedDailyVolume: Number(x.allowedDailyVolume),
                  tierName: String(x.tierName),
                  chainTxHash: x.chainTxHash ?? null,
                  relatedTokenId: x.relatedTokenId ?? null
                })),
                page: p.page,
                limit: p.limit,
                total: p.total,
                hasMore: p.hasMore
              })
            );
          })
        );
      }
      if (nftOwnershipPage.hasMore) {
        const next = nftPageNumRef.current + 1;
        tasks.push(
          nftService.history({ page: next, limit: HISTORY_PAGE_SIZE }).then((res) => {
            nftPageNumRef.current = next;
            const p = res.data.ownership;
            setNftOwnershipPage((prev) => mergePaginated(prev, p));
          })
        );
      }
      await Promise.all(tasks);
    } finally {
      setLoadingMoreVolume(false);
    }
  }, [loadingMoreVolume, volumePage.hasMore, nftOwnershipPage.hasMore]);

  const loadMoreCompliance = useCallback(async () => {
    if (loadingMoreCompliance || !compliancePage.hasMore) return;
    setLoadingMoreCompliance(true);
    try {
      const next = compliancePageNumRef.current + 1;
      const res = await tradingService.complianceHistory({ page: next, limit: HISTORY_PAGE_SIZE });
      compliancePageNumRef.current = next;
      const p = res.data;
      setCompliancePage((prev) =>
        mergePaginated(prev, {
          items: (p.items ?? []) as ComplianceRow[],
          page: p.page,
          limit: p.limit,
          total: p.total,
          hasMore: p.hasMore
        })
      );
    } finally {
      setLoadingMoreCompliance(false);
    }
  }, [compliancePage.hasMore, loadingMoreCompliance]);

  const filtered = useMemo(() => {
    if (filter === "all") return compliancePage.items;
    return compliancePage.items.filter((r) => r.status === filter);
  }, [compliancePage.items, filter]);

  const unifiedVolumeRows = useMemo((): UnifiedVolumeRow[] => {
    const seenVol = new Set<string>();
    const volPart: UnifiedVolumeRow[] = [];
    for (const v of volumePage.items) {
      const tx = v.chainTxHash?.trim().toLowerCase();
      const tid = v.relatedTokenId?.trim();
      const key = tx && tid ? `${tx}:${tid}` : v.id;
      if (seenVol.has(key)) continue;
      seenVol.add(key);
      volPart.push({ rowKind: "volume", ...v });
    }
    const salePart: UnifiedVolumeRow[] = nftOwnershipPage.items
      .filter((o) => o.role === "seller")
      .map((o) => ({
        rowKind: "nft_sale" as const,
        id: `nft-sold-${o.id}`,
        tradeDate: o.createdAt,
        volume: Number(o.priceUsdt),
        tokenId: o.tokenId,
        chainTxHash: o.txHash
      }));
    return [...volPart, ...salePart].sort(
      (a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime()
    );
  }, [volumePage.items, nftOwnershipPage.items]);

  const volumeHasMore = volumePage.hasMore || nftOwnershipPage.hasMore;

  const filterBtn = (id: HistoryFilter, label: string) => {
    const on = filter === id;
    return (
      <button
        type="button"
        onClick={() => setFilter(id)}
        className={
          on
            ? "tab-pill tab-pill--active rounded-[18px] px-4 py-2 text-xs font-semibold sm:text-[13px]"
            : "rounded-[18px] border border-[rgba(0,198,255,0.45)] bg-transparent px-4 py-2 text-xs font-semibold text-[#8b9bb4] shadow-[0_0_12px_rgba(123,47,247,0.15)] sm:text-[13px]"
        }
      >
        {label}
      </button>
    );
  };

  const statusLabel = (s: ComplianceRow["status"]) => {
    if (s === "compliant") return "Compliant";
    if (s === "non_compliant") return "Miss";
    return "Inactive";
  };

  /** Primary heading for each history row (transaction-style title). */
  const recordTitle = (s: ComplianceRow["status"]) => {
    if (s === "compliant") return "Daily compliance — target met";
    if (s === "non_compliant") return "Daily compliance — below required volume";
    return "Daily compliance — inactive day";
  };

  const statusClass = (s: ComplianceRow["status"]) => {
    if (s === "compliant") return "bg-[#22E6A0]/15 text-[#22E6A0]";
    if (s === "non_compliant") return "bg-[#FF2FD1]/15 text-[#FF2FD1]";
    return "bg-white/10 text-[#8b9bb4]";
  };

  return (
    <MobileShell>
      <SubScreenHeader />

      <MarketTopBar />

      <MarketQuadNav
        mode="history"
        onMarket={() => navigate("/market?tab=market")}
        onNft={() => navigate("/market?tab=nft")}
        onMyNfts={() => navigate("/market?tab=my-nfts&my=in")}
        onTradingHistory={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      />

      <h2 className="mb-2 text-lg font-bold text-white">Trading history</h2>

      {error ? (
        <p className="mb-3 rounded-2xl border border-[#ff6b8a]/35 bg-[#ff6b8a]/10 px-4 py-3 text-sm text-[#ffb3c4]">{error}</p>
      ) : null}

      <main className="flex flex-col gap-3">
        {loading ? (
          <TradingHistorySkeleton />
        ) : (
          <>
            <h3 className="text-sm font-bold text-white">Volume log</h3>
            {!error && unifiedVolumeRows.length === 0 ? (
              <p className="-mt-1 mb-1 text-[13px] leading-relaxed text-[#8b9bb4]">
                No volume or NFT resale entries yet. NFT purchases (`buy()`) appear as volume when the indexer
                matches your linked wallet; NFTs you sell are listed here in red.
              </p>
            ) : null}
            {unifiedVolumeRows.length === 0 ? null : (
              unifiedVolumeRows.map((row, i) => {
                const isSold = row.rowKind === "nft_sale";
                const isPurchase = row.rowKind === "volume" && Boolean(row.relatedTokenId);
                const accent =
                  isSold
                    ? "border-l-[#ff6b8a] text-[#ffb3c4]"
                    : isPurchase
                      ? "border-l-[#22E6A0] text-[#b8f5de]"
                      : "border-l-white/20 text-[#c5d0e0]";
                const amountColor = isSold ? "text-[#ff6b8a]" : isPurchase ? "text-[#22E6A0]" : "text-[#22E6A0]";
                const title = isSold
                  ? `NFT sold · #${row.tokenId}`
                  : isPurchase
                    ? "NFT purchased (volume)"
                    : "Volume submission";
                const tx = row.rowKind === "nft_sale" ? row.chainTxHash : row.chainTxHash;
                return (
                <motion.div
                  key={row.id}
                  className={`neon-card border-l-4 p-4 ${accent}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <p className={`mb-2 text-[13px] font-bold leading-snug ${isSold ? "text-[#ff6b8a]" : isPurchase ? "text-[#22E6A0]" : "text-white"}`}>
                    {title}
                  </p>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8b9bb4]">Time</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-white">
                        {new Date(row.tradeDate).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short"
                        })}
                      </p>
                      {row.rowKind === "volume" ? (
                        <p className="mt-1 text-[11px] text-[#8b9bb4]">Package: {row.tierName}</p>
                      ) : (
                        <p className="mt-1 text-[11px] text-[#8b9bb4]">Token #{row.tokenId}</p>
                      )}
                    </div>
                    <span className={`font-mono text-base font-bold ${amountColor}`}>{formatMoney(row.volume)} USDT</span>
                  </div>
                  {row.rowKind === "volume" ? (
                    <div className="mt-2 text-[11px] text-[#8b9bb4]">
                      Daily allowance at log time: {formatMoney(row.allowedDailyVolume)} USDT
                      {row.relatedTokenId ? (
                        <span className="ml-2 font-mono text-white/70">· Token #{row.relatedTokenId}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {tx ? (
                    <div className="mt-2 border-t border-white/10 pt-2">
                      <div className="mt-1 font-mono text-[11px]">
                        <ExplorerTxLink txHash={tx} className="text-[#22E6A0] underline" />
                      </div>
                    </div>
                  ) : null}
                </motion.div>
                );
              })
            )}
            <LoadMoreButton
              hasMore={volumeHasMore}
              loading={loadingMoreVolume}
              onLoadMore={() => void loadMoreVolume()}
            />

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-white">Daily compliance</h3>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter daily compliance">
                {filterBtn("all", "All")}
                {filterBtn("compliant", "OK")}
                {filterBtn("non_compliant", "Miss")}
                {filterBtn("inactive", "Idle")}
              </div>
            </div>
            {!error && compliancePage.items.length === 0 ? (
              <p className="-mt-1 mb-1 text-[13px] leading-relaxed text-[#8b9bb4]">
                No daily compliance rows yet (stored when volume is logged for a trading day).
              </p>
            ) : null}
            {!error && compliancePage.items.length > 0 && filtered.length === 0 ? (
              <p className="text-[13px] text-[#8b9bb4]">No rows match this filter.</p>
            ) : null}
            {filtered.length === 0 ? null : (
              filtered.map((t, i) => (
                <motion.div
                  key={t.id}
                  className="neon-card p-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <p className="mb-2 text-[13px] font-bold leading-snug text-white">{recordTitle(t.status)}</p>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8b9bb4]">Trading day</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-white">
                        {new Date(t.day).toLocaleString(undefined, { dateStyle: "medium" })}
                      </p>
                      <p className="mt-1 text-[11px] text-[#8b9bb4]">
                        Streak miss: {t.consecutiveMiss}
                      </p>
                    </div>
                    <span className={`rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase ${statusClass(t.status)}`}>
                      {statusLabel(t.status)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                    <span className="text-sm font-medium text-[#8b9bb4]">Volume (achieved / required)</span>
                    <span className="font-mono text-sm font-bold text-white">
                      {formatMoney(vol(t.achievedVolume))} / {formatMoney(vol(t.requiredVolume))}
                    </span>
                  </div>
                </motion.div>
              ))
            )}
            <LoadMoreButton
              hasMore={compliancePage.hasMore}
              loading={loadingMoreCompliance}
              onLoadMore={() => void loadMoreCompliance()}
            />
          </>
        )}
      </main>
    </MobileShell>
  );
}
