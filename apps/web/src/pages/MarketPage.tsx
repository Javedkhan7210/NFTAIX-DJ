import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ExplorerTxLink } from "../components/ExplorerTxLink";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { MarketQuadNav } from "../components/MarketQuadNav";
import { MarketTopBar } from "../components/MarketTopBar";
import { MobileShell } from "../components/MobileShell";
import {
  MarketTradingDashboardSkeleton,
  NftMarketplaceGridSkeleton
} from "../components/SkeletonLoaders";
import { SubScreenHeader } from "../components/SubScreenHeader";
import { resolveApiAssetUrl } from "../lib/apiAsset";
import { formatMoney } from "../lib/formatCrypto";
import { getUserFacingError } from "../lib/getUserFacingError";
import {
  approveAndBuyNft,
  isOwnListingPurchaseError,
  OWN_LISTING_PURCHASE_ERROR
} from "../lib/onChainMarketplace";
import { getInjectedProvider, peekWalletAddress, requestWalletAddress, WALLET_DISCONNECT_EVENT } from "../lib/wallet";
import { marketService, type MarketListingDto } from "../services/marketService";
import { nftService } from "../services/nftService";
import { chainService, registrationAddressFromStatus } from "../services/chainService";
import { tradingService, type TradingDashboardDto } from "../services/tradingService";
import { userService } from "../services/userService";
import { usePollingWhileVisible } from "../lib/usePollingWhileVisible";
import { useAuth } from "../context/AuthContext";
import type { Address } from "viem";

const PORTFOLIO_PAGE_SIZE = 50;

/** Max NFT cards on the Market → NFT tab grid. */
const NFT_MARKETPLACE_VISIBLE_COUNT = 48;

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="neon-card neon-card--inner p-4">
      <p className="label-caps mb-2">{label}</p>
      <p className="text-xl font-bold tracking-tight text-white">{value}</p>
    </div>
  );
}

function TimeCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="neon-card neon-card--inner flex flex-col items-center justify-center py-4">
      <span className="text-2xl font-bold tabular-nums text-white">{value}</span>
      <span className="mt-1 text-[11px] text-[#8b9bb4]">{label}</span>
    </div>
  );
}

function formatIsoDateTime(iso: string | undefined): string | null {
  if (iso == null || !String(iso).trim()) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return null;
  }
}

function myNftMarketStatusLabel(status: "hold" | "for_sale" | undefined): string {
  if (status === "for_sale") return "In sell queue (auto-listed)";
  if (status === "hold") return "On hold (near burn)";
  return "Not in your portfolio";
}

/** On-chain resales: FIFO queue position from `getNftQueue()` (0 = next to sell). */
function listingQueuePosition(l: MarketListingDto): number {
  if (typeof l.queuePosition === "number" && Number.isFinite(l.queuePosition)) {
    return l.queuePosition;
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Same token can appear twice in `getNftQueue()` — keep the earliest queue slot. */
function dedupeListingsByTokenId(listings: MarketListingDto[]): MarketListingDto[] {
  const byToken = new Map<string, MarketListingDto>();
  for (const l of listings) {
    const key = l.tokenId != null ? String(l.tokenId) : l.id;
    const prev = byToken.get(key);
    if (!prev || listingQueuePosition(l) < listingQueuePosition(prev)) {
      byToken.set(key, l);
    }
  }
  return [...byToken.values()];
}

type NftCardPurchasePhase = "idle" | "preparing" | "wallet" | "confirming";

function NftCard({
  listing,
  onBuy,
  purchasePhase,
  tradingSoon,
  isOwnResale,
  botActive
}: {
  listing: MarketListingDto;
  onBuy: (listing: MarketListingDto) => void;
  purchasePhase: NftCardPurchasePhase;
  /** When true, purchase is disabled and the CTA shows a coming-soon state. */
  tradingSoon?: boolean;
  /** True when this token is in the user’s portfolio (`/api/nfts`) — cannot buy your own resale. */
  isOwnResale?: boolean;
  /** When true, auto-trade bot is also running (manual buy still allowed). */
  botActive?: boolean;
}) {
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    setImgBroken(false);
  }, [listing.id]);

  const askFromChain = parseFloat(listing.priceUsdt);
  const priceLabel = Number.isFinite(askFromChain) ? `${formatMoney(askFromChain)} USDT` : "—";

  const imgSrc =
    listing.imageUrl && !imgBroken
      ? listing.imageUrl.startsWith("http")
        ? listing.imageUrl
        : resolveApiAssetUrl(listing.imageUrl)
      : null;

  const fallbackSlotSeed = Number.parseInt(String(listing.tokenId ?? listing.tokenNumber), 10);
  const fallbackSlot = Number.isFinite(fallbackSlotSeed) ? ((fallbackSlotSeed - 1) % 10 + 10) % 10 + 1 : 1;
  const fallbackImgSrc = resolveApiAssetUrl(`/market-nfts/nft-${String(fallbackSlot).padStart(2, "0")}.png`);
  const finalImgSrc = imgSrc ?? fallbackImgSrc;

  const tokenLabel =
    listing.tokenId === "next"
      ? "Mint"
      : listing.tokenId != null
        ? `#${listing.tokenId}`
        : `#${listing.tokenNumber}`;

  const buyBlocked = Boolean(tradingSoon) || Boolean(isOwnResale) || purchasePhase !== "idle";

  const buyLabel = tradingSoon
    ? "Trading soon"
    : isOwnResale
      ? "Your listing"
      : purchasePhase === "wallet"
        ? "Confirm in wallet…"
        : purchasePhase === "confirming"
          ? "Confirming…"
          : purchasePhase === "preparing"
            ? "Preparing…"
            : "Buy";

  const buyTitle = tradingSoon
    ? "Trading is not available yet."
    : isOwnResale
      ? "This is your listing — you cannot buy your own resale."
      : botActive
        ? "Manual buy (auto-trade bot also runs FIFO in the background)."
        : "Buy via wallet — on-chain buy() takes the next FIFO item.";

  return (
    <motion.div
      className="neon-card neon-card--inner flex flex-col overflow-hidden p-0"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.25 }}
    >
      <div className="relative aspect-square w-full shrink-0 bg-black/40">
        {finalImgSrc ? (
          <img
            src={finalImgSrc}
            alt=""
            className="h-full w-full object-cover object-center"
            loading="lazy"
            onError={() => {
              if (!imgBroken) setImgBroken(true);
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-[#1a2332] to-black px-3 text-center text-[11px] text-[#8b9bb4]">
            <span>No artwork</span>
            <span className="font-mono text-[10px] text-white/70">{tokenLabel}</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-lg bg-black/55 px-2 py-0.5 font-mono text-[10px] font-bold text-white/95 backdrop-blur-sm">
          {tokenLabel}
        </span>
        <span className="absolute right-2 top-2 rounded-lg bg-black/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90 backdrop-blur-sm">
          {listing.tier}
        </span>
        {botActive ? (
          <span className="absolute bottom-2 left-2 rounded-lg bg-[#00D1FF]/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">
            Bot on
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2 text-[11px] leading-snug text-[#c5d0e0]">
          <p className="font-mono text-base font-bold text-[#22E6A0]">{priceLabel}</p>
        </div>
        <motion.button
          type="button"
          className={`btn-neon-fill w-full py-2.5 text-sm font-semibold disabled:opacity-55 ${buyBlocked ? "cursor-not-allowed" : ""}`}
          onClick={() => {
            if (!buyBlocked) onBuy(listing);
          }}
          whileTap={buyBlocked ? undefined : { scale: 0.98 }}
          disabled={buyBlocked}
          title={buyTitle}
        >
          {buyLabel}
        </motion.button>
      </div>
    </motion.div>
  );
}

export function MarketPage() {
  const navigate = useNavigate();
  const { isAuthenticated, hasFullAccess } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const [purchaseTokenId, setPurchaseTokenId] = useState<string | null>(null);
  const [purchasePendingTxHash, setPurchasePendingTxHash] = useState<string | null>(null);
  const [purchaseFlowPhase, setPurchaseFlowPhase] = useState<"preparing" | "wallet" | "confirming">("preparing");
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const isNft = tab === "nft";
  const isMyNfts = tab === "my-nfts";
  const mySubtab = searchParams.get("my") === "sold" ? "sold" : "in-sale";

  const [listings, setListings] = useState<MarketListingDto[]>([]);
  const [primaryMintPrice, setPrimaryMintPrice] = useState<string | null>(null);
  const [queueLength, setQueueLength] = useState<number | null>(null);
  const [marketSource, setMarketSource] = useState<"on-chain" | "catalog" | null>(null);
  const [catalogFallbackReason, setCatalogFallbackReason] = useState<
    "missing-env" | "on-chain-read-failed" | null
  >(null);
  const [missingChainEnv, setMissingChainEnv] = useState<string[]>([]);
  const [catalogFallbackDetail, setCatalogFallbackDetail] = useState<string | null>(null);
  const [nftLoading, setNftLoading] = useState(false);
  const [nftError, setNftError] = useState<string | null>(null);
  const [sellFeePercent, setSellFeePercent] = useState<number | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  /** Logged-in account wallet from API — used for “Your listing”, not MetaMask alone. */
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const [myNfts, setMyNfts] = useState<
    Array<{
      id: string;
      tokenId: string;
      baseValue: string | number;
      /** When set, USDT paid for this token (matches volume log); prefer over `baseValue` for display. */
      purchaseUsdt?: string | number | null;
      currentValue: string | number;
      mintedAt: string;
      purchaseTime?: string | null;
      marketStatus?: "hold" | "for_sale";
      imageUrl?: string;
    }>
  >([]);
  const [soldNfts, setSoldNfts] = useState<
    Array<{
      id: string;
      tokenId: string;
      priceUsdt: string;
      kind: string;
      txHash: string;
      createdAt: string;
      toWallet: string;
    }>
  >([]);
  const [myNftsLoading, setMyNftsLoading] = useState(false);
  const [myNftsError, setMyNftsError] = useState<string | null>(null);
  const [myNftsHasMore, setMyNftsHasMore] = useState(false);
  const [soldHasMore, setSoldHasMore] = useState(false);
  const [portfolioLoadingMore, setPortfolioLoadingMore] = useState(false);
  const portfolioLoadSeqRef = useRef(0);
  const portfolioPageRef = useRef(1);
  const portfolioPollReadyRef = useRef(false);
  const chainAddrsRef = useRef<{ mp: string; usdt: string; registration: string } | null>(null);
  const myNftsCountRef = useRef(0);
  const purchaseInFlightRef = useRef(false);

  useEffect(() => {
    myNftsCountRef.current = myNfts.length;
  }, [myNfts.length]);

  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);
  const [dash, setDash] = useState<TradingDashboardDto | null>(null);

  const navMode: "market" | "nft" | "my-nfts" = isMyNfts ? "my-nfts" : isNft ? "nft" : "market";

  const goMarket = () => {
    setSearchParams({}, { replace: true });
  };

  const goNft = () => {
    setSearchParams({ tab: "nft" }, { replace: true });
  };

  const goMyNfts = () => {
    if (isMyNfts) return;
    setSearchParams({ tab: "my-nfts", my: "in" }, { replace: true });
  };

  const setMyPortfolioSubtab = (sub: "in-sale" | "sold") => {
    setSearchParams({ tab: "my-nfts", my: sub === "sold" ? "sold" : "in" }, { replace: true });
  };

  useEffect(() => {
    if (isNft) return;
    let cancelled = false;
    (async () => {
      setDashLoading(true);
      setDashError(null);
      try {
        const res = await tradingService.dashboard();
        if (!cancelled) setDash(res.data);
      } catch (err) {
        if (!cancelled) {
          setDash(null);
          setDashError(getUserFacingError(err));
        }
      } finally {
        if (!cancelled) setDashLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNft]);

  useEffect(() => {
    if (!isNft) return;
    let cancelled = false;
    (async () => {
      setNftLoading(true);
      setNftError(null);
      try {
        const [listRes, dashRes] = await Promise.all([
          marketService.listings({ maxScan: 200 }),
          tradingService.dashboard().catch(() => null)
        ]);
        if (!cancelled && dashRes?.data) {
          setDash(dashRes.data);
        }
        if (!cancelled) {
          const rawListings = listRes.data.listings;
          setListings(Array.isArray(rawListings) ? rawListings : []);
          setPrimaryMintPrice(listRes.data.primaryMint?.priceUsdt ?? null);
          const qRaw = (listRes.data as { queueLength?: string | number }).queueLength;
          setQueueLength(qRaw != null && qRaw !== "" ? Number(qRaw) : null);
          setMarketSource(listRes.data.source);
          setSellFeePercent(listRes.data.sellFeePercent ?? null);
          setCatalogFallbackReason(listRes.data.catalogFallbackReason ?? null);
          setMissingChainEnv(
            Array.isArray(listRes.data.missingChainEnv) ? listRes.data.missingChainEnv : []
          );
          setCatalogFallbackDetail(listRes.data.catalogFallbackDetail ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setNftError(getUserFacingError(err));
          setListings([]);
          setPrimaryMintPrice(null);
          setQueueLength(null);
          setMarketSource(null);
          setSellFeePercent(null);
          setCatalogFallbackReason(null);
          setMissingChainEnv([]);
          setCatalogFallbackDetail(null);
        }
      } finally {
        if (!cancelled) setNftLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNft]);

  useEffect(() => {
    if (!isAuthenticated || !hasFullAccess) {
      setConnectedWallet(null);
      setSessionWallet(null);
      return;
    }
    if (!isNft && !isMyNfts) return;
    void peekWalletAddress().then((addr) => setConnectedWallet(addr));
    let eth:
      | (ReturnType<typeof getInjectedProvider> & {
          on?(event: string, handler: (...args: unknown[]) => void): void;
          removeListener?(event: string, handler: (...args: unknown[]) => void): void;
        })
      | undefined;
    try {
      eth = getInjectedProvider();
    } catch {
      eth = undefined;
    }
    const onAccounts = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? String(accounts[0] ?? "").trim() : "";
      setConnectedWallet(first || null);
    };
    const onWalletDisconnect = () => {
      setConnectedWallet(null);
      setSessionWallet(null);
    };
    eth?.on?.("accountsChanged", onAccounts);
    window.addEventListener(WALLET_DISCONNECT_EVENT, onWalletDisconnect);
    return () => {
      eth?.removeListener?.("accountsChanged", onAccounts);
      window.removeEventListener(WALLET_DISCONNECT_EVENT, onWalletDisconnect);
    };
  }, [isAuthenticated, hasFullAccess, isNft, isMyNfts]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSessionWallet(null);
      return;
    }
    if (!isNft && !isMyNfts) return;
    let cancelled = false;
    void userService
      .profile()
      .then((res) => {
        if (cancelled) return;
        const connections = (res.data as { walletConnections?: { walletAddress: string; isPrimary?: boolean }[] })
          ?.walletConnections;
        const primary =
          connections?.find((w) => w.isPrimary)?.walletAddress ?? connections?.[0]?.walletAddress ?? null;
        setSessionWallet(primary?.trim().toLowerCase() ?? null);
      })
      .catch(() => {
        if (!cancelled) setSessionWallet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isNft, isMyNfts]);

  useEffect(() => {
    if (!isNft && !isMyNfts) return;
    void chainService.status().then((res) => {
      const st = res.data;
      const mp = st.marketplace?.trim();
      const usdt = st.usdt?.trim();
      const registration = registrationAddressFromStatus(st);
      if (mp && usdt && registration) chainAddrsRef.current = { mp, usdt, registration };
    });
  }, [isNft, isMyNfts]);

  const loadMyNftPortfolio = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++portfolioLoadSeqRef.current;
    const subtabAtStart = mySubtab;
    const isCurrent = () => seq === portfolioLoadSeqRef.current;
    if (!opts?.silent) {
      setMyNftsLoading(true);
      setMyNftsError(null);
    }
    try {
      portfolioPageRef.current = 1;
      if (subtabAtStart === "sold") {
        const res = await nftService.sold({
          page: 1,
          limit: PORTFOLIO_PAGE_SIZE,
          refresh: false
        });
        const rows = res.data?.items ?? [];
        if (!isCurrent()) return;
        setSoldNfts((prev) => {
          if (opts?.silent && rows.length < prev.length && prev.length > 0) return prev;
          return rows;
        });
        setSoldHasMore(Boolean(res.data?.hasMore));
        setMyNfts([]);
        setMyNftsHasMore(false);
      } else {
        const res = await nftService.list({ page: 1, limit: PORTFOLIO_PAGE_SIZE });
        const rows = res.data?.items ?? [];
        if (!isCurrent()) return;
        setMyNfts(rows as typeof myNfts);
        setMyNftsHasMore(Boolean(res.data?.hasMore));
        setSoldNfts([]);
        setSoldHasMore(false);
      }
    } catch (err) {
      if (!isCurrent() || opts?.silent) return;
      if (subtabAtStart === "sold") {
        setSoldNfts([]);
      } else {
        setMyNfts([]);
        setSoldNfts([]);
      }
      setMyNftsError(
        getUserFacingError(err)
      );
    } finally {
      if (!opts?.silent) setMyNftsLoading(false);
    }
  }, [mySubtab]);

  const loadMorePortfolio = useCallback(async () => {
    if (portfolioLoadingMore) return;
    setPortfolioLoadingMore(true);
    const next = portfolioPageRef.current + 1;
    try {
      if (mySubtab === "sold") {
        const res = await nftService.sold({ page: next, limit: PORTFOLIO_PAGE_SIZE });
        portfolioPageRef.current = next;
        setSoldNfts((prev) => [...prev, ...(res.data?.items ?? [])]);
        setSoldHasMore(Boolean(res.data?.hasMore));
      } else {
        const res = await nftService.list({ page: next, limit: PORTFOLIO_PAGE_SIZE });
        portfolioPageRef.current = next;
        setMyNfts((prev) => [...prev, ...((res.data?.items ?? []) as typeof myNfts)]);
        setMyNftsHasMore(Boolean(res.data?.hasMore));
      }
    } catch {
      /* keep existing rows */
    } finally {
      setPortfolioLoadingMore(false);
    }
  }, [mySubtab, portfolioLoadingMore]);

  const reloadPortfolioAfterPurchase = useCallback(async (expectTokenId?: string, txHash?: string) => {
    const wantId = expectTokenId?.trim();
    if (txHash) {
      void chainService.syncRecent(txHash).catch(() => {});
    }
    if (myNftsCountRef.current === 0) setMyNftsLoading(true);
    setMyNftsError(null);
    let found = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await nftService.list({ page: 1, limit: 50 });
        const rows = res.data?.items ?? [];
        setMyNfts(rows as typeof myNfts);
        setMyNftsHasMore(Boolean(res.data?.hasMore));
        found = !wantId || rows.some((n) => String(n.tokenId) === wantId);
        if (found) break;
      } catch (err) {
        if (attempt >= 9) {
          setMyNfts([]);
          setMyNftsError(getUserFacingError(err));
        }
      }
      if (attempt < 9) await new Promise((r) => window.setTimeout(r, 2_000));
    }
    setMyNftsLoading(false);
    return found;
  }, []);

  useEffect(() => {
    if (!isMyNfts) {
      portfolioPollReadyRef.current = false;
      return;
    }
    portfolioPollReadyRef.current = false;
    void loadMyNftPortfolio().finally(() => {
      portfolioPollReadyRef.current = true;
    });
  }, [isMyNfts, loadMyNftPortfolio]);

  usePollingWhileVisible(() => {
    if (!portfolioPollReadyRef.current) return;
    return loadMyNftPortfolio({ silent: true });
  }, 15_000, isMyNfts);

  const portfolioShowSkeleton =
    myNftsLoading && (mySubtab === "sold" ? soldNfts.length === 0 : myNfts.length === 0);

  const pctUsed = useMemo(() => {
    const cap = dash?.currentTier?.dailyAllowance ?? dash?.currentTier?.tradingLimit ?? 0;
    const used = dash?.totalTradedVolume ?? 0;
    if (cap <= 0) return { usedPct: 0, remPct: 100 };
    const u = Math.min(100, (used / cap) * 100);
    return { usedPct: u, remPct: 100 - u };
  }, [dash]);

  const connectedWalletLower = connectedWallet?.toLowerCase() ?? null;
  const sessionWalletLower = sessionWallet?.toLowerCase() ?? null;
  const walletMismatch =
    Boolean(sessionWalletLower && connectedWalletLower) && sessionWalletLower !== connectedWalletLower;

  const listingIsOwnResale = useCallback(
    (l: MarketListingDto) => {
      // Match logged-in account wallet (API), not only MetaMask — avoids “Your listing” on wrong login.
      const ownerWallet = sessionWalletLower ?? connectedWalletLower;
      const seller = (l.saleOwner ?? l.seller)?.trim().toLowerCase();
      if (!seller || seller === "0x0000000000000000000000000000000000000000") return false;
      return Boolean(ownerWallet && seller === ownerWallet);
    },
    [sessionWalletLower, connectedWalletLower]
  );

  const { visibleListings, allListingsWereOwnResales } = useMemo(() => {
    let rows = listings.filter((l) => {
      if (l.listingKind === "catalog") return true;
      if (l.listingKind !== "secondary" && l.listingKind !== "on-chain") return false;
      return Boolean(l.tokenId);
    });
    // Primary mint card only when FIFO is empty (buy() mints fresh)
    const hasFifo = rows.some((l) => String(l.tokenId) !== "next");
    const hasNext = rows.some((l) => String(l.tokenId) === "next");
    const queueEmpty = queueLength === 0 || (queueLength == null && !hasFifo);
    if (!hasNext && queueEmpty && primaryMintPrice && marketSource === "on-chain") {
      rows = [
        {
          id: `onchain-next-${primaryMintPrice}`,
          tokenNumber: 0,
          tokenId: "next",
          name: `Primary mint · $${primaryMintPrice}`,
          tier: "FIFO",
          priceUsdt: primaryMintPrice,
          imageUrl: "",
          listingKind: "on-chain",
          seller: null,
          queuePosition: 0
        },
        ...rows
      ];
    } else if (hasFifo) {
      // Drop stray mint cards when queue has real listings
      rows = rows.filter((l) => String(l.tokenId) !== "next");
    }
    const resale = dedupeListingsByTokenId(
      rows.map((l) => ({
        ...l,
        name: l.tokenId === "next" ? `Primary mint · $${l.priceUsdt}` : l.name,
        saleOwner: l.saleOwner ?? l.seller ?? undefined,
        queuePosition: l.queuePosition ?? (l.tokenId === "next" ? 0 : 0)
      }))
    );
    const sorted = [...resale].sort((a, b) => listingQueuePosition(a) - listingQueuePosition(b));
    const buyable = sorted.filter((l) => !listingIsOwnResale(l));
    return {
      visibleListings: sorted.slice(0, NFT_MARKETPLACE_VISIBLE_COUNT),
      allListingsWereOwnResales: sorted.length > 0 && buyable.length === 0
    };
  }, [listings, listingIsOwnResale, primaryMintPrice, marketSource, queueLength]);

  const refreshNftViews = async (opts?: { silent?: boolean }) => {
    const onNftTab = new URLSearchParams(window.location.search).get("tab") === "nft";
    if (onNftTab && !opts?.silent) setNftLoading(true);
    const hasPortfolioData = mySubtab === "sold" ? soldNfts.length > 0 : myNfts.length > 0;
    if (!opts?.silent && !hasPortfolioData) setMyNftsLoading(true);
    try {
      const freshListings = await marketService.listings({ maxScan: 200 });
      setListings(Array.isArray(freshListings.data.listings) ? freshListings.data.listings : []);
      setPrimaryMintPrice(freshListings.data.primaryMint?.priceUsdt ?? null);
      const qRaw = (freshListings.data as { queueLength?: string | number }).queueLength;
      setQueueLength(qRaw != null && qRaw !== "" ? Number(qRaw) : null);
      setMarketSource(freshListings.data.source);
      setCatalogFallbackReason(freshListings.data.catalogFallbackReason ?? null);
      setMissingChainEnv(
        Array.isArray(freshListings.data.missingChainEnv) ? freshListings.data.missingChainEnv : []
      );
      setCatalogFallbackDetail(freshListings.data.catalogFallbackDetail ?? null);
      setSellFeePercent(freshListings.data.sellFeePercent ?? null);
    } finally {
      if (onNftTab && !opts?.silent) setNftLoading(false);
    }
    try {
      const freshMine = await nftService.list({ page: 1, limit: 50 }).catch(() => null);
      const mine = freshMine?.data?.items ?? [];
      setMyNfts(mine as typeof myNfts);
      setMyNftsHasMore(Boolean(freshMine?.data?.hasMore));
      const freshSold = await nftService.sold({ page: 1, limit: 50, refresh: true }).catch(() => null);
      const soldRows = freshSold?.data?.items ?? [];
      setSoldNfts(soldRows);
      setSoldHasMore(Boolean(freshSold?.data?.hasMore));
    } finally {
      setMyNftsLoading(false);
    }
  };

  const onBuyNft = async (listing: MarketListingDto) => {
    /** Purchases are on-chain via MetaMask — NFTMarketplace.buy() (FIFO next in queue). */
    setNotice(null);
    setPurchasePendingTxHash(null);
    if ((listing.listingKind !== "secondary" && listing.listingKind !== "on-chain") || !listing.tokenId) {
      setNotice("Only on-chain FIFO queue listings can be purchased. Configure the marketplace or wait for listings.");
      return;
    }
    if (listingIsOwnResale(listing)) {
      setNotice(OWN_LISTING_PURCHASE_ERROR);
      return;
    }
    if (walletMismatch) {
      setNotice(
        "MetaMask wallet does not match your logged-in account. Switch MetaMask to the same wallet you signed in with, then retry."
      );
      return;
    }
    if (purchaseInFlightRef.current) return;

    purchaseInFlightRef.current = true;
    const expectTokenId = String(listing.tokenId);
    setPurchaseTokenId(expectTokenId);
    setPurchaseFlowPhase("preparing");

    const finishPurchaseFlow = () => {
      purchaseInFlightRef.current = false;
      setPurchaseTokenId(null);
      setPurchasePendingTxHash(null);
      setPurchaseFlowPhase("preparing");
    };

    try {
      let mp: string | undefined;
      let usdt: string | undefined;
      let registration: string | undefined;
      const cached = chainAddrsRef.current;
      if (cached) {
        ({ mp, usdt, registration } = cached);
      } else {
        const statusRes = await chainService.status();
        const st = statusRes.data;
        mp = st.marketplace?.trim();
        usdt = st.usdt?.trim();
        registration = registrationAddressFromStatus(st);
        if (mp && usdt && registration) chainAddrsRef.current = { mp, usdt, registration };
      }
      if (!mp || !usdt || !registration) {
        setNotice(
          "On-chain marketplace is not configured (missing marketplace, USDT, or Registration in API env). Check MARKETPLACE_CONTRACT_ADDRESS, REGISTRATION_CONTRACT_ADDRESS, and chain status."
        );
        finishPurchaseFlow();
        return;
      }

      flushSync(() => setPurchaseFlowPhase("wallet"));
      const hash = await approveAndBuyNft({
        marketplace: mp as Address,
        usdt: usdt as Address,
        registration: registration as Address
      });
      flushSync(() => setPurchaseFlowPhase("confirming"));
      setPurchasePendingTxHash(hash);
      void chainService.syncRecent(hash).catch(() => {});
      await reloadPortfolioAfterPurchase(expectTokenId, hash);
      await refreshNftViews({ silent: true });
      void peekWalletAddress().then((addr) => setConnectedWallet(addr));
      try {
        const d = await tradingService.dashboard();
        setDash(d.data);
      } catch {
        /* best-effort */
      }
      finishPurchaseFlow();
    } catch (err) {
      if (isOwnListingPurchaseError(err)) {
        setNotice(OWN_LISTING_PURCHASE_ERROR);
      } else {
        setNotice(getUserFacingError(err));
      }
      finishPurchaseFlow();
    }
  };

  return (
    <MobileShell>
      <SubScreenHeader />

      {purchasePendingTxHash ? (
        <motion.div className="mb-3 rounded-2xl border border-[#00D1FF]/35 bg-[#001a28]/80 px-4 py-3 text-sm text-[#c5d0e0]">
          <p>
            Purchase submitted for NFT #{purchaseTokenId ?? "…"}. Waiting for on-chain confirmation…{" "}
            <ExplorerTxLink txHash={purchasePendingTxHash} showHash={false} />
          </p>
        </motion.div>
      ) : null}

      {notice ? (
        <div className="mb-3 rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          <p>{notice}</p>
          {/register and activate a package on the current Registration contract/i.test(notice) ? (
            <Link to="/register" className="mt-2 inline-block font-semibold text-[#00D1FF] underline">
              Activate on current contract ($5) →
            </Link>
          ) : null}
        </div>
      ) : null}

      <MarketTopBar
        packageUsedPct={dash ? pctUsed.usedPct : undefined}
        periodEndsAt={dash?.periodEndsAt ?? dash?.todayCompliance?.periodEndsAt}
      />

      <MarketQuadNav
        mode={navMode}
        onMarket={goMarket}
        onNft={() => {
          goNft();
        }}
        onMyNfts={goMyNfts}
        onTradingHistory={() => navigate("/market/trading-history")}
      />

      {isNft ? (
        <main className="flex flex-col gap-4">
          {nftError ? (
            <p className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              {nftError}
            </p>
          ) : null}

          {walletMismatch ? (
            <p className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-center text-[11px] text-amber-100">
              Logged in as <span className="font-mono text-white/90">{sessionWalletLower?.slice(0, 8)}…</span> but
              MetaMask is <span className="font-mono text-white/90">{connectedWalletLower?.slice(0, 8)}…</span>. Switch
              MetaMask to your logged-in wallet before buying.
            </p>
          ) : null}

          {allListingsWereOwnResales ? (
            <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-center text-[11px] text-[#8b9bb4]">
              All queue listings are yours — cards stay visible but{" "}
              <span className="font-semibold text-white/80">Buy</span> is disabled on your listings. Switch wallet to
              purchase from another user, or check <span className="font-mono text-white/80">My NFTs</span>.
            </p>
          ) : null}

          {dash?.autoTradeBotEnabled ? (
            <p className="text-center text-[11px] text-[#8b9bb4]">
              Auto-trade bot is <span className="font-semibold text-[#00D1FF]">on</span> (FIFO on-chain). You can still
              buy manually from any card.
            </p>
          ) : null}

          {marketSource ? (
            <p className="text-center text-[11px] font-medium uppercase tracking-wide text-[#8b9bb4]">
              Listings:{" "}
              <span className="text-white/80">{marketSource === "on-chain" ? "On-chain" : "Catalog"}</span>
              {queueLength != null && Number.isFinite(queueLength) ? (
                <>
                  {" "}
                  · Queue <span className="text-white/80">{queueLength}</span>
                </>
              ) : null}
              {visibleListings.length > 0 ? (
                <>
                  {" "}
                  · Showing <span className="text-white/80">{visibleListings.length}</span>
                </>
              ) : null}
              {sellFeePercent != null && Number.isFinite(sellFeePercent) ? (
                <>
                  {" "}
                  · Resale fee <span className="text-white/80">{sellFeePercent}%</span>
                </>
              ) : null}
            </p>
          ) : null}

          {nftLoading ? (
            <NftMarketplaceGridSkeleton count={8} />
          ) : visibleListings.length === 0 ? (
            <div className="neon-card neon-card--inner px-4 py-8 text-center text-sm text-[#8b9bb4]">
              <p className="mb-2">No listings to show right now.</p>
              {marketSource === "catalog" ? (
                <p className="text-[11px] text-[#6b7a90]">
                  {catalogFallbackReason === "on-chain-read-failed" ? (
                    <>
                      On-chain read failed
                      {catalogFallbackDetail ? (
                        <>
                          : <span className="text-amber-200/80">{catalogFallbackDetail}</span>
                        </>
                      ) : null}
                      . Check API <span className="font-mono text-white/70">CHAIN_RPC_URL</span> and marketplace
                      address, then restart the API.
                    </>
                  ) : missingChainEnv.length > 0 ? (
                    <>
                      Missing API env:{" "}
                      {missingChainEnv.map((k, i) => (
                        <span key={k}>
                          {i > 0 ? ", " : null}
                          <span className="font-mono text-white/70">{k}</span>
                        </span>
                      ))}
                      . Set them in <span className="font-mono text-white/70">apps/api/.env</span> and restart.
                    </>
                  ) : (
                    <>
                      API fell back to catalog. Set marketplace / USDT / registration env + working{" "}
                      <span className="font-mono text-white/70">CHAIN_RPC_URL</span>, restart API, then confirm{" "}
                      <span className="font-mono text-white/70">GET /api/market/listings</span> returns{" "}
                      <span className="font-mono text-white/70">source: &quot;on-chain&quot;</span>.
                    </>
                  )}
                </p>
              ) : marketSource === "on-chain" ? (
                <p className="text-[11px] text-[#6b7a90]">
                  On-chain mode is active. Pull to refresh — when the queue is empty a primary mint card (~$11) should
                  appear for <span className="font-mono text-white/70">buy()</span>.
                </p>
              ) : (
                <p className="text-[11px] text-[#6b7a90]">
                  Confirm <span className="font-mono text-white/70">VITE_API_URL</span> points at{" "}
                  <span className="font-mono text-white/70">http://localhost:4000</span>.
                </p>
              )}
            </div>
          ) : (
            <section className="grid grid-cols-2 gap-3 pb-6" aria-label="NFT marketplace">
              {visibleListings.map((listing) => {
                const tid = listing.tokenId != null ? String(listing.tokenId) : "";
                const isOwnResale = listingIsOwnResale(listing);
                return (
                  <NftCard
                    key={`${tid || listing.id}-${listing.queuePosition ?? 0}`}
                    listing={listing}
                    onBuy={onBuyNft}
                    purchasePhase={
                      purchaseTokenId != null &&
                      listing.tokenId != null &&
                      purchaseTokenId === String(listing.tokenId)
                        ? purchaseFlowPhase
                        : "idle"
                    }
                    isOwnResale={isOwnResale}
                    botActive={Boolean(dash?.autoTradeBotEnabled)}
                  />
                );
              })}
            </section>
          )}
          {!nftLoading && visibleListings.length > 0 ? (
            <button
              type="button"
              className="w-full rounded-xl border border-white/15 bg-white/5 py-2 text-[11px] font-semibold text-[#8b9bb4]"
              onClick={() => void refreshNftViews({ silent: false })}
            >
              Refresh listings
            </button>
          ) : null}
        </main>
      ) : isMyNfts ? (
        <main className="flex flex-col gap-4">
          {!connectedWallet ? (
            <button
              type="button"
              onClick={() =>
                void requestWalletAddress()
                  .then((addr) => setConnectedWallet(addr))
                  .catch((err) => setNotice(getUserFacingError(err)))
              }
              className="w-full rounded-xl border border-[#00D1FF]/40 bg-[#00D1FF]/10 py-2.5 text-xs font-semibold text-[#00D1FF]"
            >
              Connect wallet (chain {import.meta.env.VITE_OPBNB_CHAIN_ID || "—"})
            </button>
          ) : (
            <p className="text-center text-[11px] text-[#8b9bb4]">
              Wallet {connectedWallet.slice(0, 6)}…{connectedWallet.slice(-4)} · Buys auto-list into the FIFO sell
              queue at +10%
            </p>
          )}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="My NFTs">
            <button
              type="button"
              role="tab"
              aria-selected={mySubtab === "in-sale"}
              onClick={() => setMyPortfolioSubtab("in-sale")}
              className={
                mySubtab === "in-sale"
                  ? "tab-pill tab-pill--active rounded-[18px] px-4 py-2 text-xs font-semibold sm:text-[13px]"
                  : "rounded-[18px] border border-[rgba(0,198,255,0.45)] bg-transparent px-4 py-2 text-xs font-semibold text-[#8b9bb4] shadow-[0_0_12px_rgba(123,47,247,0.15)] sm:text-[13px]"
              }
            >
              In sale
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mySubtab === "sold"}
              onClick={() => setMyPortfolioSubtab("sold")}
              className={
                mySubtab === "sold"
                  ? "tab-pill tab-pill--active rounded-[18px] px-4 py-2 text-xs font-semibold sm:text-[13px]"
                  : "rounded-[18px] border border-[rgba(0,198,255,0.45)] bg-transparent px-4 py-2 text-xs font-semibold text-[#8b9bb4] shadow-[0_0_12px_rgba(123,47,247,0.15)] sm:text-[13px]"
              }
            >
              Sold
            </button>
          </div>
          {myNftsError ? (
            <p className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              {myNftsError}
            </p>
          ) : null}
          {portfolioShowSkeleton ? (
            <NftMarketplaceGridSkeleton count={4} />
          ) : mySubtab === "sold" ? (
            soldNfts.length === 0 ? (
              <div className="neon-card neon-card--inner px-4 py-8 text-center text-sm text-[#8b9bb4]">
                No sold NFTs yet. When you resell on-chain, your sales appear here.
              </div>
            ) : (
              <>
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Sold NFTs">
                {soldNfts.map((s) => {
                  const soldLine = formatIsoDateTime(s.createdAt);
                  const txHash = s.txHash?.trim();
                  return (
                    <div key={s.id} className="neon-card neon-card--inner flex flex-col overflow-hidden p-0">
                      <div className="relative aspect-square w-full bg-black/40">
                        <img
                          src={resolveApiAssetUrl(
                            `/market-nfts/nft-${String(((Number(s.tokenId) - 1) % 10 + 10) % 10 + 1).padStart(2, "0")}.png`
                          )}
                          alt={`NFT #${s.tokenId}`}
                          className="h-full w-full object-cover object-center"
                          loading="lazy"
                        />
                        <span className="absolute left-2 top-2 rounded-lg bg-black/55 px-2 py-0.5 font-mono text-[11px] font-bold text-white/95 backdrop-blur-sm">
                          ID #{s.tokenId}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 p-4">
                        <p className="font-mono text-sm font-bold tabular-nums text-[#FF6B8A]">Sold · NFT #{s.tokenId}</p>
                        {txHash ? (
                          <p className="text-[11px] text-[#8b9bb4]">
                            Tx:{" "}
                            <ExplorerTxLink
                              txHash={txHash}
                              className="font-mono text-[11px] text-[#00D1FF] underline"
                            />
                          </p>
                        ) : null}
                        {soldLine ? (
                          <p className="text-[11px] text-[#8b9bb4]">
                            Sold: <span className="text-white/85">{soldLine}</span>
                          </p>
                        ) : null}
                        <p className="truncate font-mono text-[10px] text-[#8b9bb4]" title={s.toWallet}>
                          Buyer {s.toWallet.slice(0, 10)}…{s.toWallet.slice(-6)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </section>
              <LoadMoreButton
                hasMore={soldHasMore}
                loading={portfolioLoadingMore}
                onLoadMore={() => void loadMorePortfolio()}
              />
              </>
            )
          ) : myNfts.length === 0 ? (
            <div className="neon-card neon-card--inner px-4 py-8 text-center text-sm text-[#8b9bb4]">
              No active listings yet. Buy on the NFT tab — your purchase auto-lists into the FIFO sell queue and shows
              here. After someone buys yours, check Sold.
            </div>
          ) : (
            <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="My NFTs">
              {myNfts.map((n) => {
                const purchaseLine = formatIsoDateTime(n.purchaseTime ?? n.mintedAt);
                const purchaseRaw = n.purchaseUsdt ?? n.baseValue;
                const purchaseNum =
                  purchaseRaw != null && purchaseRaw !== ""
                    ? typeof purchaseRaw === "number"
                      ? purchaseRaw
                      : Number(purchaseRaw)
                    : NaN;
                const hasPurchase = Number.isFinite(purchaseNum);
                return (
                <div key={n.id} className="neon-card neon-card--inner flex flex-col overflow-hidden p-0">
                  <div className="relative aspect-square w-full bg-black/40">
                    <img
                      src={resolveApiAssetUrl(n.imageUrl || `/market-nfts/nft-${String(((Number(n.tokenId) - 1) % 10 + 10) % 10 + 1).padStart(2, "0")}.png`)}
                      alt={`NFT #${n.tokenId}`}
                      className="h-full w-full object-cover object-center"
                      loading="lazy"
                    />
                    <span className="absolute left-2 top-2 rounded-lg bg-black/55 px-2 py-0.5 font-mono text-[11px] font-bold text-white/95 backdrop-blur-sm">
                      ID #{n.tokenId}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    <p className="font-mono text-sm font-bold tabular-nums text-[#22E6A0]">NFT ID #{n.tokenId}</p>
                    {hasPurchase ? (
                      <p className="text-sm font-bold text-white">
                        Purchase price {formatMoney(purchaseNum)}
                      </p>
                    ) : null}
                    {purchaseLine ? (
                      <p className="text-[11px] text-[#8b9bb4]">
                        Purchased: <span className="text-white/85">{purchaseLine}</span>
                      </p>
                    ) : null}
                    <p className="text-[11px] font-medium text-[#c5d0e0]">{myNftMarketStatusLabel(n.marketStatus)}</p>
                    {n.marketStatus === "hold" ? (
                      <p className="text-[10px] text-[#8b9bb4]">
                        On hold (packages above $10). Buys again → this NFT lists at +10%; the new one is held.
                      </p>
                    ) : (
                      <p className="text-[10px] text-[#8b9bb4]">
                        In the sell queue (auto after buy). Manual list is disabled.
                      </p>
                    )}
                  </div>
                </div>
                );
              })}
            </section>
            <LoadMoreButton
              hasMore={myNftsHasMore}
              loading={portfolioLoadingMore}
              onLoadMore={() => void loadMorePortfolio()}
            />
            </>
          )}
        </main>
      ) : (
        <main className="flex flex-col gap-4">
          {dashError ? (
            <p className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{dashError}</p>
          ) : null}

          {dashLoading ? (
            <MarketTradingDashboardSkeleton />
          ) : (
            <>
              <section>
                <h2 className="mb-2 text-base font-bold text-white">Trading session</h2>
                {/* <p className="mb-2 text-[11px] text-[#6b7a90]">
                  Trading limit resets every {dash?.tradingPeriodHours ?? 15} hours (e.g. $5 package → $50 per period).
                </p> */}
                <div className="grid grid-cols-3 gap-2">
                  <TimeCell
                    label="Today's achieved"
                    value={formatMoney(dash?.todayCompliance?.achievedVolume ?? 0)}
                  />
                  <TimeCell
                    label="Today's required"
                    value={formatMoney(
                      dash?.todayCompliance?.requiredVolume ?? dash?.currentTier?.dailyAllowance ?? 0
                    )}
                  />
                  <TimeCell label="Daily allowance" value={formatMoney(dash?.currentTier?.dailyAllowance ?? 0)} />
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <StatCell
                  label="Current subscription"
                  value={
                    dash?.currentTier
                      ? dash.currentTier.name
                      : "—"
                  }
                />
                <StatCell label="Traded this period" value={formatMoney(dash?.totalTradedVolume ?? 0)} />
                {/* <StatCell
                  label="Today's required"
                  value={formatMoney(dash?.todayCompliance?.requiredVolume ?? dash?.currentTier?.dailyAllowance ?? 0)}
                />
                <StatCell label="Per-day allowance" value={formatMoney(dash?.currentTier?.dailyAllowance ?? 0)} /> */}
              </section>

              <div className="neon-card neon-card--inner p-4">
                <p className="label-caps mb-1">Daily limit remaining (this period)</p>
                <p className="text-xl font-bold text-white">{formatMoney(dash?.remainingTradingLimit ?? 0)}</p>
              </div>

              <p className="text-center text-xs font-medium text-[#8b9bb4]">
                <span className="text-[#6b7a90]">This period · </span>
                <span className="text-white/80">{formatMoney(dash?.totalTradedVolume ?? 0)}</span>{" "}
                <span className="text-[#8b9bb4]">
                  ({pctUsed.usedPct.toFixed(2)}% of {formatMoney(dash?.currentTier?.dailyAllowance ?? 0)} daily cap)
                </span>
                <span className="mx-2 text-white/30">|</span>
                <span className="text-white/80">{formatMoney(dash?.remainingTradingLimit ?? 0)}</span>{" "}
                <span className="text-[#8b9bb4]">({pctUsed.remPct.toFixed(2)}% left today)</span>
              </p>
            </>
          )}
        </main>
      )}
    </MobileShell>
  );
}

//old code