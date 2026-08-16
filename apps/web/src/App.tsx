import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { navTabs } from "./components/BottomNav";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { MobileShell } from "./components/MobileShell";
import { AutoTradePage } from "./pages/AutoTradePage";
import { FriendsPage } from "./pages/FriendsPage";
import { IncomePage } from "./pages/IncomePage";
import { MarketPage } from "./pages/MarketPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TradingHistoryPage } from "./pages/TradingHistoryPage";
import { useAuth } from "./context/AuthContext";
import { formatMoney } from "./lib/formatCrypto";
import { userService } from "./services/userService";
import { publicContentService, type DashboardContentPayload } from "./services/publicContentService";
import { LandingPage } from "./pages/LandingPage";
import { resolveApiAssetUrl } from "./lib/apiAsset";
import { LoginPage } from "./pages/LoginPage";
import { ReferralRedirectPage } from "./pages/ReferralRedirectPage";
import { RegisterPage } from "./pages/RegisterPage";
import { UpgradePage } from "./pages/UpgradePage";
import { HeaderStatsBar } from "./components/HeaderStatsBar";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminOverview } from "./pages/admin/AdminOverview";
import { AdminContentPage } from "./pages/admin/AdminContentPage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminEconomyPage } from "./pages/admin/AdminEconomyPage";
import { AdminNftsPage } from "./pages/admin/AdminNftsPage";
import { AdminChainPage } from "./pages/admin/AdminChainPage";
import { AdminLoginPage } from "./pages/admin/AdminLoginPage";
import { AdminSuperControlCenter } from "./pages/admin/AdminSuperControlCenter";
import { AdminUserNftDetailsPage } from "./pages/admin/AdminUserNftDetailsPage";
import { AdminBotPurchasesPage } from "./pages/admin/AdminBotPurchasesPage";

function AdminHomeRedirect() {
  const role = typeof localStorage !== "undefined" ? localStorage.getItem("role") : null;
  if (role === "superadmin") return <Navigate to="/admin/control-center" replace />;
  return <AdminOverview />;
}

/** `/` → landing when logged out, dashboard when logged in. */
function RootPage() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/home" replace />;
  return <Navigate to="/login" replace />;
}

function ComingSoonPage({
  title,
  items,
  telegramUrl,
  whatsAppUrl
}: {
  title?: string;
  items?: string[];
  telegramUrl?: string;
  whatsAppUrl?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060812] px-4 text-white">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/30 p-6 text-center">
        <p className="label-caps mb-2">Maintenance mode</p>
        <h1 className="text-2xl font-bold">{title?.trim() || "Coming Soon"}</h1>
        {items?.length ? (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-left text-sm text-[#8b9bb4]">
            {items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        ) : null}
        {(telegramUrl || whatsAppUrl) ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {telegramUrl ? <a className="rounded-xl border border-white/15 px-3 py-1.5 text-sm" href={telegramUrl} target="_blank" rel="noreferrer">Telegram</a> : null}
            {whatsAppUrl ? <a className="rounded-xl border border-white/15 px-3 py-1.5 text-sm" href={whatsAppUrl} target="_blank" rel="noreferrer">WhatsApp</a> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        d="M12 22a2 2 0 002-2H10a2 2 0 002 2zM18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" strokeLinecap="round" />
    </svg>
  );
}

/** Direct rewards / personal assist. */
function IconDirectAi() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        d="M12 3v2.5M12 18.5V21M4.94 4.94l1.77 1.77M17.29 17.29l1.77 1.77M3 12h2.5M18.5 12H21M4.94 19.06l1.77-1.77M17.29 6.71l1.77-1.77"
        strokeLinecap="round"
      />
      <rect x="8.5" y="9.5" width="7" height="5" rx="1" strokeLinejoin="round" />
      <path d="M10 12h4" strokeLinecap="round" />
    </svg>
  );
}

/** Network / pool rewards (linked NFT-style tokens). */
function IconNetworkNft() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M8 5.5L13 8.25v5.5L8 16.5 3 13.75V8.25L8 5.5z" strokeLinejoin="round" />
      <path d="M16 7.5L21 10.25v5.5L16 18.5l-5-2.75v-5.5L16 7.5z" strokeLinejoin="round" />
      <path d="M12.5 10.25L14.25 11.2" strokeLinecap="round" />
    </svg>
  );
}

function IconUpgrade() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconAutoTrade() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M7 7h10l-3-3M17 17H7l3 3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12h18" strokeLinecap="round" />
    </svg>
  );
}

function IconIncome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 18V6M4 18h16M8 14l4-4 4 4M12 6v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTeamsAction() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function NeonWaveChart() {
  const uid = useId().replace(/:/g, "");
  const gradId = `wave-grad-${uid}`;
  const wavePath =
    "M0 52 C28 52 36 28 64 28 C92 28 100 48 128 48 C156 48 164 22 192 22 C220 22 228 44 256 44 C276 44 284 32 320 32";

  return (
    <div className="relative mt-5 h-[72px] w-full overflow-hidden rounded-xl">
      <svg className="h-full w-full" viewBox="0 0 320 72" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="320" y2="0">
            <stop offset="0%" stopColor="#00D1FF" />
            <stop offset="50%" stopColor="#8A2EFF" />
            <stop offset="100%" stopColor="#FF2FD1" />
          </linearGradient>
        </defs>
        <motion.path
          d={wavePath}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={7}
          strokeLinecap="round"
          opacity={0.22}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.path
          d={wavePath}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(138,46,255,0.75))" }}
          initial={{ pathLength: 0, opacity: 0.5 }}
          animate={{ pathLength: 1, opacity: [0.88, 1, 0.92] }}
          transition={{
            pathLength: { duration: 2.2, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 3.5, repeat: Infinity, ease: "easeInOut" }
          }}
        />
      </svg>
    </div>
  );
}

function WalletCard({
  displayAddress,
  fullAddress,
  totalEarnings,
  loading
}: {
  displayAddress: string;
  fullAddress: string;
  totalEarnings: number;
  loading: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!fullAddress) return;
    try {
      await navigator.clipboard.writeText(fullAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <motion.div
      className="neon-card p-5"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-4">
        <div className={`flex min-h-0 flex-col gap-3 ${totalEarnings > 0 ? "flex-1" : "w-full"}`}>
          <p className="label-caps">Wallet</p>
          <div className="copy-chip min-h-[44px] flex-1 items-center">
            <span className="font-mono text-lg font-semibold tracking-tight text-white/95">
              {loading ? "…" : displayAddress}
            </span>
            <motion.button
              type="button"
              onClick={onCopy}
              disabled={!fullAddress}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#8b9bb4] transition-colors hover:border-[#00D1FF]/40 hover:text-white disabled:pointer-events-none disabled:opacity-35"
              whileHover={{ scale: 1.06, boxShadow: "0 0 16px rgba(0,209,255,0.25)" }}
              whileTap={{ scale: 0.95 }}
              aria-label="Copy wallet address"
            >
              <IconCopy />
            </motion.button>
            {copied ? (
              <motion.span
                className="text-xs font-semibold text-[#22E6A0]"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
              >
                Copied
              </motion.span>
            ) : null}
          </div>
        </div>
        {totalEarnings > 0 ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 sm:items-end sm:text-right">
            <p className="label-caps w-full sm:text-right">Earnings</p>
            <div className="flex min-h-[44px] flex-1 flex-col justify-center gap-1 sm:items-end">
              <p className="font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {loading ? "…" : formatMoney(totalEarnings)}
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <NeonWaveChart />
    </motion.div>
  );
}

function StatCard({
  icon,
  title,
  value,
  earnings
}: {
  icon: ReactNode;
  title: string;
  value: string;
  earnings?: string;
}) {
  return (
    <motion.div
      className="neon-card neon-card--inner p-4"
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-center gap-3">
        <div className="icon-pill flex size-11 shrink-0 items-center justify-center rounded-full text-white [&>svg]:block [&>svg]:shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="label-caps">{title}</p>
          <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">{value}</p>
          {earnings ? <p className="mt-1 text-sm font-medium text-[#8b9bb4]">{earnings}</p> : null}
        </div>
      </div>
    </motion.div>
  );
}

function DashboardShortcuts() {
  const navigate = useNavigate();

  return (
    <div className="neon-card p-5">
      <p className="label-caps mb-4">Shortcuts</p>
      <div className="grid grid-cols-2 gap-3">
        <motion.button
          type="button"
          className="btn-neon-fill flex flex-col items-start gap-2 px-4 py-3.5 text-left"
          whileHover={{ scale: 1.02, filter: "brightness(1.08)" }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate("/upgrade")}
        >
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <IconUpgrade /> Upgrade
          </span>
        </motion.button>
        <motion.button
          type="button"
          className="btn-neon-fill flex flex-col items-start gap-2 px-4 py-3.5 text-left"
          whileHover={{ scale: 1.02, filter: "brightness(1.08)" }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate("/auto-trade")}
        >
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <IconAutoTrade /> Auto Trade
          </span>
        </motion.button>
        <motion.button
          type="button"
          className="btn-neon-ghost flex items-center gap-3 px-4 py-3.5 text-left"
          whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(138,46,255,0.2)" }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate("/income")}
        >
          <span className="icon-pill flex h-10 w-10 shrink-0 items-center justify-center text-white">
            <IconIncome />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">Income</span>
            <span className="text-xs text-[#8b9bb4]">View earnings</span>
          </span>
        </motion.button>
        <motion.button
          type="button"
          className="btn-neon-ghost flex items-center gap-3 px-4 py-3.5 text-left"
          whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(138,46,255,0.2)" }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate("/team")}
        >
          <span className="icon-pill flex h-10 w-10 shrink-0 items-center justify-center text-white">
            <IconTeamsAction />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">Teams</span>
          </span>
        </motion.button>
      </div>
    </div>
  );
}

const menuExtraLinks = [
  { label: "Upgrade", path: "/upgrade" },
  { label: "Auto Trade", path: "/auto-trade" },
  { label: "Trading History", path: "/market/trading-history" }
] as const;

const hiddenSidebarPaths = new Set<string>(["/market", "/upgrade", "/auto-trade"]);

function Header({ pageLabel }: { pageLabel: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const adminRole = typeof localStorage !== "undefined" ? localStorage.getItem("role") : null;
  const showAdmin = adminRole === "admin" || adminRole === "superadmin";

  const closeMenu = () => setMenuOpen(false);
  const go = (path: string) => {
    closeMenu();
    navigate(path);
  };

  const onLogout = async () => {
    closeMenu();
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <>
      <header className="relative z-20 mb-5 flex items-center justify-between gap-3">
        <motion.button
          type="button"
          className="header-icon-btn"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="app-side-menu"
          onClick={() => setMenuOpen(true)}
        >
          <IconMenu />
        </motion.button>
        <div className="flex flex-1 flex-col items-center text-center">
          <motion.img
            src="/logo-nftaix.png"
            alt="NFTaix — neon AI &amp; NFT wordmark"
            className="header-logo h-[72px] w-auto max-w-[min(280px,72vw)] object-contain sm:h-[88px]"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-[#8b9bb4]">{pageLabel}</p>
        </div>
        {showAdmin ? (
          <motion.button
            type="button"
            className="header-icon-btn text-[11px] font-bold uppercase tracking-wide text-[#22E6A0]"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            aria-label="Admin panel"
            onClick={() => {
              const base =
                typeof import.meta.env.VITE_ADMIN_ORIGIN === "string" && import.meta.env.VITE_ADMIN_ORIGIN.trim()
                  ? import.meta.env.VITE_ADMIN_ORIGIN.trim().replace(/\/$/, "")
                  : "http://localhost:5174";
              window.location.href = base;
            }}
          >
            ADM
          </motion.button>
        ) : null}
        <motion.button
          type="button"
          className="header-icon-btn"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          aria-label="Notifications"
        >
          <IconBell />
        </motion.button>
      </header>

      <AnimatePresence>
        {menuOpen ? (
          <>
            <motion.button
              key="menu-backdrop"
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-[10020] border-0 bg-black/55 p-0 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMenu}
            />
            <motion.aside
              key="menu-panel"
              id="app-side-menu"
              role="dialog"
              aria-modal="true"
              aria-label="App menu"
              className="fixed left-0 top-0 z-[10030] flex h-[100dvh] max-h-[100dvh] w-[min(88vw,300px)] flex-col border-r border-white/10 bg-[rgba(6,8,18,0.98)] shadow-[6px_0_40px_rgba(0,0,0,0.55)]"
              initial={{ x: "-105%" }}
              animate={{ x: 0 }}
              exit={{ x: "-105%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                <img src="/logo-nftaix.png" alt="NFTaix — neon AI &amp; NFT wordmark" className="h-8 w-auto object-contain" />
                <button type="button" className="header-icon-btn !w-10 !text-lg" onClick={closeMenu} aria-label="Close menu">
                  ×
                </button>
              </div>
              <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-3 [-webkit-overflow-scrolling:touch]" aria-label="App pages">
                {navTabs
                  .filter((t) => !hiddenSidebarPaths.has(t.path))
                  .map(({ label, path }) => (
                  <button
                    key={path}
                    type="button"
                    className="rounded-xl px-3 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/10"
                    onClick={() => go(path)}
                  >
                    {label}
                  </button>
                ))}
                {menuExtraLinks
                  .filter((t) => !hiddenSidebarPaths.has(t.path))
                  .map(({ label, path }) => (
                  <button
                    key={path}
                    type="button"
                    className="rounded-xl px-3 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/10"
                    onClick={() => go(path)}
                  >
                    {label}
                  </button>
                ))}
                <div className="mt-auto border-t border-white/10 pt-2">
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-3 text-left text-sm font-semibold text-[#ff6b8a] transition hover:bg-white/10"
                    onClick={onLogout}
                  >
                    Log out
                  </button>
                </div>
              </nav>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

type ProfileRow = {
  id?: string;
  publicUserNumber?: number;
  /** From API: false when packages are paid only via wallet on-chain. */
  custodialUsdtEnabled?: boolean;
  /** Set when the account was opened via on-chain Registration activate (package 1). */
  registrationTxHash?: string | null;
  directReferralCount?: number;
  teamCount?: number;
  walletConnections?: { walletAddress: string; isPrimary: boolean }[];
  packageActivations?: Array<{
    id: string;
    tierId: string;
    activatedAt: string;
    chainTxHash?: string | null;
    onChain?: boolean;
    tier: { id: string; name: string; activationAmount: string | number; tradingLimit: string | number };
  }>;
};

function DashboardPage({ pageLabel }: { pageLabel: string }) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [cms, setCms] = useState<DashboardContentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cmsUpdatedAtRef = useRef<string | null>(null);
  const [heroMuted, setHeroMuted] = useState(true);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  const toggleHeroSound = () => {
    const v = heroVideoRef.current;
    setHeroMuted((prev) => {
      const next = !prev;
      if (v) {
        v.muted = next;
        void v.play().catch(() => {});
      }
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const pRes = await userService.profile().catch(() => null);
        const cRes = await publicContentService.dashboardContent().catch(() => null);
        if (cancelled) return;
        if (pRes?.data) setProfile(pRes.data as ProfileRow);
        if (cRes?.data?.payload) {
          setCms(cRes.data.payload as DashboardContentPayload);
          cmsUpdatedAtRef.current = cRes.data.updatedAt ?? null;
        }
        if (!pRes?.data) {
          setError("Could not load your dashboard summary right now. Please refresh.");
        }
      } catch {
        if (!cancelled) setError("Could not load your dashboard. Check the API and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refreshCms = async () => {
      try {
        const cRes = await publicContentService.dashboardContent();
        const u = cRes.data?.updatedAt;
        if (u && cmsUpdatedAtRef.current === u) return;
        cmsUpdatedAtRef.current = u ?? null;
        if (cRes?.data?.payload) setCms(cRes.data.payload as DashboardContentPayload);
      } catch {
        /* ignore background refresh errors */
      }
    };
    const id = window.setInterval(() => void refreshCms(), 90_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshCms();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // NOTE: Home "Featured" slider is hidden for now.

  const directCount = profile?.directReferralCount ?? 0;
  const teamCount = profile?.teamCount ?? 0;

  // NOTE: Home slider autoplay effect removed (slider hidden).

  return (
    <MobileShell>
      <Header pageLabel={pageLabel} />

      <main className="flex flex-col gap-4">
        <div className="neon-card overflow-hidden p-0">
          <div className="relative aspect-[16/9] w-full bg-black/30">
            <video
              className="h-full w-full object-cover"
              src="/home-hero.mp4"
              autoPlay
              muted={heroMuted}
              loop
              playsInline
              preload="metadata"
              ref={heroVideoRef}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
            <div className="absolute inset-0 flex items-end justify-end p-3">
              <button
                type="button"
                className="rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-xs font-semibold text-white backdrop-blur"
                onClick={toggleHeroSound}
                aria-pressed={!heroMuted}
              >
                {heroMuted ? "Enable sound" : "Mute sound"}
              </button>
            </div>
          </div>
        </div>

        <HeaderStatsBar showWallet />

        {error ? (
          <p className="rounded-2xl border border-[#ff6b8a]/35 bg-[#ff6b8a]/10 px-4 py-3 text-sm text-[#ffb3c4]">{error}</p>
        ) : null}

        {loading ? (
          <DashboardShortcuts />
        ) : (
          <>
            {cms?.notifications?.length ? (
          <div className="space-y-2">
            {cms.notifications.map((n) => (
              <div
                key={n.id}
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  n.severity === "warning"
                    ? "border-amber-400/35 bg-amber-950/40 text-amber-100"
                    : "border-cyan-400/25 bg-cyan-950/30 text-cyan-50"
                }`}
              >
                <p className="font-semibold text-white">{n.title}</p>
              </div>
            ))}
          </div>
        ) : null}

        {/* Featured slider hidden for now */}

        {cms?.comingSoon?.enabled ? (
          <div className="neon-card p-4">
            <p className="label-caps mb-1">Coming soon</p>
            {cms.comingSoon.title ? <p className="text-lg font-bold text-white">{cms.comingSoon.title}</p> : null}
          </div>
        ) : null}

        {(cms?.socialLinks?.telegramUrl || cms?.socialLinks?.whatsAppUrl) ? (
          <div className="flex flex-wrap gap-3">
            {cms.socialLinks.telegramUrl ? (
              <a
                href={cms.socialLinks.telegramUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
              >
                Telegram
              </a>
            ) : null}
            {cms.socialLinks.whatsAppUrl ? (
              <a
                href={cms.socialLinks.whatsAppUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
              >
                WhatsApp
              </a>
            ) : null}
          </div>
            ) : null}

            <section className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<IconDirectAi />}
                title="Direct"
                value={`${directCount} users`}
              />
              <StatCard
                icon={<IconNetworkNft />}
                title="My Team"
                value={`${teamCount} users`}
              />
            </section>

            <DashboardShortcuts />
          </>
        )}
      </main>
    </MobileShell>
  );
}

export function App() {
  const location = useLocation();
  const [gatePayload, setGatePayload] = useState<DashboardContentPayload | null>(null);
  const [gateLoading, setGateLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await publicContentService.dashboardContent();
        if (!cancelled) setGatePayload(c.data.payload as DashboardContentPayload);
      } catch {
        if (!cancelled) setGatePayload(null);
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdminRoute = location.pathname.startsWith("/admin");
  const comingSoonEnabled = Boolean(gatePayload?.comingSoon?.enabled);

  if (!isAdminRoute && gateLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#060812] text-[#8b9bb4]">Loading...</div>;
  }
  if (comingSoonEnabled && !isAdminRoute) {
    return (
      <ComingSoonPage
        title={gatePayload?.comingSoon?.title}
        items={gatePayload?.comingSoon?.items}
        telegramUrl={gatePayload?.socialLinks?.telegramUrl}
        whatsAppUrl={gatePayload?.socialLinks?.whatsAppUrl}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden">
      <Routes>
        <Route path="/" element={<RootPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/ref/:code" element={<ReferralRedirectPage />} />
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <DashboardPage pageLabel="Home" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/income"
          element={
            <ProtectedRoute>
              <IncomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/market"
          element={
            <ProtectedRoute>
              <MarketPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/market/trading-history"
          element={
            <ProtectedRoute>
              <TradingHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/friend"
          element={
            <ProtectedRoute>
              <FriendsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/team"
          element={
            <ProtectedRoute>
              <TeamsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/upgrade"
          element={
            <ProtectedRoute>
              <UpgradePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["admin", "superadmin"]} forbiddenRedirect="/admin/login">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route
            path="control-center"
            element={
              <ProtectedRoute allowedRoles={["superadmin"]} forbiddenRedirect="/admin">
                <AdminSuperControlCenter />
              </ProtectedRoute>
            }
          />
          <Route index element={<AdminHomeRedirect />} />
          <Route path="content" element={<AdminContentPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="economy" element={<AdminEconomyPage />} />
          <Route path="nfts" element={<AdminNftsPage />} />
          <Route path="user-nft-details" element={<AdminUserNftDetailsPage />} />
          <Route path="bot-purchases" element={<AdminBotPurchasesPage />} />
          <Route path="nfts/on-chain-mint" element={<Navigate to="/admin/nfts" replace />} />
          <Route path="chain" element={<AdminChainPage />} />
        </Route>
        <Route
          path="/auto-trade"
          element={
            <ProtectedRoute>
              <AutoTradePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
