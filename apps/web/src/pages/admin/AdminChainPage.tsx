import { useCallback, useEffect, useState } from "react";
import { ExplorerAddressLink } from "../../components/ExplorerAddressLink";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { opbnbExplorerAddress } from "../../lib/opbnb";

type NetworkOverview = Awaited<ReturnType<typeof adminService.networksOverview>>["data"]["networks"][number];

const CONTRACT_LABELS: Array<{ field: string; label: string; balanceTarget?: string; altFields?: string[] }> = [
  { field: "registration", label: "Registration", balanceTarget: "registration" },
  { field: "marketplace", label: "NFTMarketplace", balanceTarget: "marketplace" },
  { field: "rewards", label: "Rewards", balanceTarget: "rewards", altFields: ["burnReward"] },
  { field: "globalPool", label: "GlobalPool", balanceTarget: "globalPool" },
  { field: "treasury", label: "Treasury", balanceTarget: "treasury" },
  { field: "liquidityManager", label: "LiquidityManager", balanceTarget: "liquidityManager", altFields: ["lpReward"] },
  { field: "nft", label: "NFT", balanceTarget: "nft" },
  { field: "usdt", label: "USDT" },
  { field: "nftaixToken", label: "NFTAIX token" },
  { field: "marketplaceImpl", label: "Marketplace impl" }
];

function formatUsdt(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDT`;
}

function NetworkPanel({ net }: { net: NetworkOverview }) {
  const contracts = net.contracts;
  const balanceByTarget = (target: string | undefined) =>
    target ? net.balances.rows.find((r) => r.target === target) : undefined;

  return (
    <div
      className={`neon-card overflow-hidden p-0 ${net.isActive ? "ring-1 ring-[#22E6A0]/50" : "opacity-95"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-base font-bold text-white">
            {net.name}{" "}
            <span className="font-mono text-sm font-normal text-[#8b9bb4]">({net.chainId})</span>
          </p>
          <p className="mt-0.5 text-xs text-[#8b9bb4]">
            RPC: <span className="font-mono text-[#c5d0e0]">{net.isActive && net.liveRpcHost ? net.liveRpcHost : net.rpcUrl.replace(/^https?:\/\//, "")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {net.isActive ? (
            <span className="rounded-full bg-[#22E6A0]/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#22E6A0]">
              API active
            </span>
          ) : (
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#8b9bb4]">
              Switch env to use
            </span>
          )}
          <a
            href={net.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[#00D1FF] underline hover:text-[#22E6A0]"
          >
            {net.explorerUrl.replace(/^https?:\/\//, "")}
          </a>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-[#8b9bb4]">
              <th className="p-3">Contract</th>
              <th className="p-3">Address</th>
              <th className="p-3 text-right">USDT balance</th>
            </tr>
          </thead>
          <tbody>
            {CONTRACT_LABELS.map(({ field, label, balanceTarget, altFields }) => {
              const rec = contracts as Record<string, string | null>;
              const addr =
                rec[field] ??
                altFields?.map((f) => rec[f]).find((a) => Boolean(a)) ??
                null;
              const bal =
                (balanceTarget ? balanceByTarget(balanceTarget) : null) ??
                (altFields
                  ? altFields.map((f) => balanceByTarget(f)).find((b) => Boolean(b))
                  : null);
              const displayBal =
                field === "usdt"
                  ? "—"
                  : bal?.balanceFormatted != null
                    ? formatUsdt(bal.balanceFormatted)
                    : bal?.error ?? "—";

              return (
                <tr key={field} className="border-b border-white/5 hover:bg-white/[0.03]">
                  <td className="p-3 font-medium text-white">{label}</td>
                  <td className="p-3">
                    {addr ? (
                      <div className="flex flex-col gap-0.5">
                        <ExplorerAddressLink address={addr} chainId={net.chainId} />
                        <span className="font-mono text-[10px] text-[#6b7a90]">{addr}</span>
                      </div>
                    ) : (
                      <span className="text-[#6b7a90]">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-[#c5d0e0]">{displayBal}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(net.balances.usdt ?? net.balances.usdtToken) ? (
        <p className="border-t border-white/10 px-4 py-2 text-xs text-[#8b9bb4]">
          USDT:{" "}
          <a
            href={opbnbExplorerAddress((net.balances.usdt ?? net.balances.usdtToken)!, net.chainId)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[#00D1FF] underline"
          >
            {net.balances.usdt ?? net.balances.usdtToken}
          </a>
          {" · "}
          <span className="text-[#6b7a90]">{net.deploymentFile}</span>
        </p>
      ) : null}

      <details className="border-t border-white/10 px-4 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-[#8b9bb4]">
          Copy {net.key} env (API + web)
        </summary>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[#6b7a90]">apps/api/.env</p>
            <pre className="overflow-auto rounded-lg bg-black/40 p-2 text-[10px] font-mono text-[#8b9bb4]">
              {net.apiEnvExample.join("\n")}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[#6b7a90]">apps/web/.env</p>
            <pre className="overflow-auto rounded-lg bg-black/40 p-2 text-[10px] font-mono text-[#8b9bb4]">
              {net.webEnvExample.join("\n")}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

type ViewNet = "testnet" | "live";

export function AdminChainPage() {
  const [networks, setNetworks] = useState<NetworkOverview[]>([]);
  const [activeChainId, setActiveChainId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewNet, setViewNet] = useState<ViewNet>(() => {
    try {
      const v = localStorage.getItem("nftaix.admin.networkView");
      return v === "live" ? "live" : "testnet";
    } catch {
      return "testnet";
    }
  });

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await adminService.networksOverview();
      setNetworks(res.data.networks);
      setActiveChainId(res.data.activeChainId);
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Could not load networks."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      await adminService.chainSync();
      setNotice("Chain indexer sync started (active API network only).");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Chain sync failed."));
    } finally {
      setSyncing(false);
    }
  };

  const testnet = networks.find((n) => n.key === "testnet");
  const mainnet = networks.find((n) => n.key === "mainnet");
  const isLiveMainnet = activeChainId === 204 || activeChainId === 56;
  const focused = viewNet === "live" ? mainnet : testnet;
  const other = viewNet === "live" ? testnet : mainnet;

  const selectView = (v: ViewNet) => {
    setViewNet(v);
    try {
      localStorage.setItem("nftaix.admin.networkView", v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#8b9bb4]">Network</span>
        <button
          type="button"
          onClick={() => selectView("testnet")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${
            viewNet === "testnet"
              ? "bg-[#00D1FF] text-[#060812]"
              : "border border-white/15 text-white hover:bg-white/10"
          }`}
        >
          Testnet
        </button>
        <button
          type="button"
          onClick={() => selectView("live")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${
            viewNet === "live"
              ? "bg-[#22E6A0] text-[#060812]"
              : "border border-white/15 text-white hover:bg-white/10"
          }`}
        >
          Live
        </button>
        {isLiveMainnet === (viewNet === "live") ? (
          <span className="rounded-full bg-[#22E6A0]/20 px-2.5 py-0.5 text-[11px] font-bold uppercase text-[#22E6A0]">
            API matches view
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-200">
            API still on {isLiveMainnet ? "Live" : "Testnet"} — set CHAIN_ID in apps/api/.env to switch
          </span>
        )}
      </div>

      <p className="text-sm text-[#8b9bb4]">
        Viewing <span className="text-white">{viewNet === "live" ? "Live (opBNB mainnet)" : "Testnet"}</span>.
        App/indexer use <span className="font-mono text-white/80">CHAIN_ID</span> in{" "}
        <span className="font-mono text-white/80">apps/api/.env</span>
        {activeChainId != null ? (
          <>
            {" "}
            (<span className="text-[#22E6A0]">currently {activeChainId}</span>).
          </>
        ) : null}
      </p>

      {notice ? (
        <p className="rounded-xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          type="button"
          disabled={syncing}
          onClick={() => void onSync()}
          className="rounded-xl bg-[#22E6A0] px-4 py-2 text-sm font-semibold text-[#060812] disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Run chain sync (active network)"}
        </button>
      </div>

      {loading && networks.length === 0 ? (
        <p className="text-sm text-[#8b9bb4]">Loading networks…</p>
      ) : (
        <div className="grid gap-4">
          {focused ? <NetworkPanel net={focused} /> : null}
          {other ? (
            <details className="neon-card p-3">
              <summary className="cursor-pointer text-sm text-[#8b9bb4]">
                Show {viewNet === "live" ? "Testnet" : "Live"} panel
              </summary>
              <div className="mt-3">
                <NetworkPanel net={other} />
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
