import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ROLE } from "../../api/client";

type AdminNavLink = { path: string; label: string; superadminOnly?: boolean };

const ADMIN_LINKS: AdminNavLink[] = [
  { path: "control-center", label: "Super Control Center", superadminOnly: true },
  { path: "", label: "Overview" },
  { path: "content", label: "Dashboard CMS" },
  { path: "users", label: "Users" },
  { path: "economy", label: "Economy" },
  { path: "nfts", label: "NFTs & listings" },
  { path: "user-nft-details", label: "User NFT details" },
  { path: "bot-purchases", label: "Resale bot" },
  // { path: "nfts/on-chain-mint", label: "Mint NFT (on-chain)" },
  { path: "chain", label: "Chain & contracts" }
];

function mainAppHomeUrl(): string {
  const o = import.meta.env.VITE_MAIN_APP_ORIGIN;
  if (typeof o === "string" && o.trim()) {
    return `${o.replace(/\/$/, "")}/home`;
  }
  return "/home";
}

export function AdminLayout() {
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  useEffect(() => {
    document.body.classList.add("admin-page");
    return () => {
      document.body.classList.remove("admin-page");
    };
  }, []);

  useEffect(() => {
    setIsSuperadmin(typeof localStorage !== "undefined" && localStorage.getItem(ROLE) === "superadmin");
  }, []);

  const visibleLinks = useMemo(
    () => ADMIN_LINKS.filter((l) => !l.superadminOnly || isSuperadmin),
    [isSuperadmin]
  );

  return (
    <div className="min-h-[100dvh] w-full bg-[#060812] text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            window.location.href = mainAppHomeUrl();
          }}
          className="text-sm text-[#8b9bb4] hover:text-white"
        >
          ← App
        </button>
        <h1 className="text-lg font-bold tracking-tight">NFTaix admin</h1>
        <nav className="flex flex-wrap gap-1">
          {visibleLinks.map((link) => (
            <NavLink
              key={link.path || "overview"}
              to={link.path ? `/admin/${link.path}` : "/admin"}
              end={link.path === "" || link.path === "nfts"}
              className={({ isActive }) =>
                isActive
                  ? "rounded-lg bg-[#22E6A0]/20 px-3 py-1.5 text-sm font-semibold text-[#22E6A0]"
                  : "rounded-lg px-3 py-1.5 text-sm text-[#8b9bb4] hover:bg-white/10"
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
