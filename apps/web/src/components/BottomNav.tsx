import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";

export const navTabs = [
  { label: "Home", path: "/home" },
  { label: "Income", path: "/income" },
  { label: "Market", path: "/market" },
  { label: "Friends", path: "/friend" },
  { label: "Teams", path: "/team" }
] as const;

function TabGlyph({ label }: { label: string }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75 };
  switch (label) {
    case "Home":
      return (
        <svg {...common} aria-hidden>
          <path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-9.5z" strokeLinejoin="round" />
        </svg>
      );
    case "Income":
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "Market":
      return (
        <svg {...common} aria-hidden>
          <path d="M4 19V5M4 19h16M8 15l3-6 3 4 3-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "Friends":
      return (
        <svg {...common} aria-hidden>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M2 20v-1.5a5 5 0 015-5h3a5 5 0 015 5V20M17 20v-1a3.5 3.5 0 013.5-3.5H22" strokeLinecap="round" />
        </svg>
      );
    case "Teams":
      return (
        <svg {...common} aria-hidden>
          <circle cx="8" cy="8" r="3" />
          <circle cx="16" cy="8" r="3" />
          <path d="M3 19v-1a5 5 0 015-5h1M16 13a5 5 0 015 5v1" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="relative z-20 shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
      <nav
        className="nav-dock grid w-full grid-cols-5 gap-1 border border-white/10 bg-[rgba(6,8,18,0.92)] p-2 shadow-[0_-4px_28px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        aria-label="Primary"
      >
        {navTabs.map(({ label, path }) => {
          const active =
            path === "/market"
              ? pathname === "/market" || pathname.startsWith("/market/")
              : pathname === path;
          return (
            <motion.button
              key={path}
              type="button"
              onClick={() => navigate(path === "/market" ? "/market?tab=nft" : path)}
              className={`tab-pill flex min-h-[52px] flex-col items-center justify-center gap-1 px-1 py-2 ${active ? "tab-pill--active" : ""}`}
              whileHover={!active ? { backgroundColor: "rgba(255,255,255,0.04)" } : undefined}
              whileTap={{ scale: 0.97 }}
            >
              <TabGlyph label={label} />
              <span className="text-[10px] font-semibold leading-none">{label}</span>
            </motion.button>
          );
        })}
      </nav>
    </div>
  );
}
