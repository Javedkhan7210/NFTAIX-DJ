import { Link, Outlet } from "react-router-dom";

const links = [
  ["/dashboard", "Dashboard"],
  ["/package-activation", "Package Activation"],
  ["/trading-status", "Trading Status"],
  ["/income-wallet", "Income Wallet"],
  ["/nft-section", "NFT Section"],
  ["/rank-section", "Rank Section"],
  ["/referral-tree", "Referral Tree"],
  ["/admin", "Admin"]
];

export function Layout() {
  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
      <nav className="mb-6 flex flex-wrap gap-3">
        {links.map(([to, label]) => (
          <Link key={to} to={to} className="theme-link rounded-xl px-3 py-2 text-sm transition">
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
      </div>
    </div>
  );
}
