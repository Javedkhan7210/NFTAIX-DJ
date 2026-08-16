import { useEffect, useState } from "react";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { formatMoney } from "../../lib/formatCrypto";
import { WalletAddressWithCopy } from "../../components/WalletAddressWithCopy";

type StaleRow = {
  purchaseTime: string;
  userId: string;
  publicUserNumber: number;
  userAddress: string;
  nftId: string;
  tokenAirdrop: number;
};

type PerUserRow = {
  userId: string;
  publicUserNumber: number;
  referralCode: string;
  userAddress: string;
  totalHold: number;
  totalInSell: number;
};

export function AdminUserNftDetailsPage() {
  const [summary, setSummary] = useState<{
    totalNftsSold: number;
    totalNftsUnsold: number;
    nftsNotSoldLast24Hours: number;
    totalHold: number;
    totalInSell: number;
  } | null>(null);
  const [perUser, setPerUser] = useState<PerUserRow[]>([]);
  const [rows, setRows] = useState<StaleRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await adminService.userNftDetails();
        if (c) return;
        setSummary(res.data.summary);
        setPerUser(res.data.perUser ?? []);
        setRows(res.data.staleHoldingsOver18Hours ?? []);
      } catch (e) {
        if (!c) setErr(getApiErrorMessage(e, "Could not load user NFT details."));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white">User NFT details</h2>
        <p className="mt-1 text-sm text-[#8b9bb4]">
          Hold vs listed counts use the same on-chain rules as the user NFT page. Token airdrop score (stale table): 2 ×
          current package + lifetime direct income.
        </p>
      </div>

      {err ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">{err}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="neon-card p-4">
          <p className="label-caps mb-1 text-[#8b9bb4]">Total hold</p>
          <p className="text-2xl font-bold text-white">{loading ? "…" : (summary?.totalHold ?? "—")}</p>
          <p className="mt-1 text-[10px] text-[#6b7a90]">In wallet, not listed</p>
        </div>
        <div className="neon-card p-4">
          <p className="label-caps mb-1 text-[#8b9bb4]">Total in sell</p>
          <p className="text-2xl font-bold text-[#22E6A0]">{loading ? "…" : (summary?.totalInSell ?? "—")}</p>
          <p className="mt-1 text-[10px] text-[#6b7a90]">Listed on marketplace</p>
        </div>
        <div className="neon-card p-4">
          <p className="label-caps mb-1 text-[#8b9bb4]">Total NFTs sold</p>
          <p className="text-2xl font-bold text-white">{loading ? "…" : (summary?.totalNftsSold ?? "—")}</p>
        </div>
        <div className="neon-card p-4">
          <p className="label-caps mb-1 text-[#8b9bb4]">Total NFTs unsold</p>
          <p className="text-2xl font-bold text-white">{loading ? "…" : (summary?.totalNftsUnsold ?? "—")}</p>
          <p className="mt-1 text-[10px] text-[#6b7a90]">DB rows (not burned)</p>
        </div>
        <div className="neon-card p-4">
          <p className="label-caps mb-1 text-[#8b9bb4]">Not sold in last 24h</p>
          <p className="text-2xl font-bold text-white">{loading ? "…" : (summary?.nftsNotSoldLast24Hours ?? "—")}</p>
          <p className="mt-1 text-[10px] text-[#6b7a90]">Held ≥ 24h since indexed acquisition</p>
        </div>
      </div>

      <div className="neon-card overflow-x-auto p-3">
        <p className="label-caps mb-2">Per user — hold &amp; in sell</p>
        {loading ? (
          <p className="text-sm text-[#8b9bb4]">Loading on-chain status…</p>
        ) : perUser.length === 0 ? (
          <p className="text-sm text-[#8b9bb4]">No users with active NFT holdings.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="text-[#8b9bb4]">
                <th className="p-2">User #</th>
                <th className="p-2">Ref</th>
                <th className="p-2">Wallet</th>
                <th className="p-2 text-right">Total hold</th>
                <th className="p-2 text-right">Total in sell</th>
              </tr>
            </thead>
            <tbody>
              {perUser.map((u) => (
                <tr key={u.userId} className="border-t border-white/5 font-mono text-[11px]">
                  <td className="p-2 text-white">
                    #{u.publicUserNumber}
                    <span className="mt-0.5 block truncate text-[10px] text-[#8b9bb4]" title={u.userId}>
                      {u.userId}
                    </span>
                  </td>
                  <td className="p-2 text-[#8b9bb4]">{u.referralCode || "—"}</td>
                  <td className="max-w-[200px] p-2">
                    {u.userAddress ? (
                      <WalletAddressWithCopy
                        addressFull={u.userAddress}
                        addressClassName="font-mono text-[10px] text-[#8b9bb4]"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-2 text-right text-white">{u.totalHold}</td>
                  <td className="p-2 text-right text-[#22E6A0]">{u.totalInSell}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="neon-card overflow-x-auto p-3">
        <p className="label-caps mb-2">NFTs not sold in the last 18 hours</p>
        {loading ? (
          <p className="text-sm text-[#8b9bb4]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[#8b9bb4]">No rows match (need held ≥ 18h since last indexed transfer to you).</p>
        ) : (
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="text-[#8b9bb4]">
                <th className="p-2">Purchase time</th>
                <th className="p-2">User ID</th>
                <th className="p-2">User address</th>
                <th className="p-2">NFT ID</th>
                <th className="p-2">Token airdrop</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.userId}-${r.nftId}`} className="border-t border-white/5 font-mono text-[11px]">
                  <td className="p-2 text-white">
                    {new Date(r.purchaseTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="p-2 text-white">
                    #{r.publicUserNumber}{" "}
                    <span className="block truncate text-[10px] text-[#8b9bb4]" title={r.userId}>
                      {r.userId}
                    </span>
                  </td>
                  <td className="max-w-[200px] truncate p-2 text-[#8b9bb4]" title={r.userAddress}>
                    {r.userAddress || "—"}
                  </td>
                  <td className="p-2 text-white">{r.nftId}</td>
                  <td className="p-2 text-[#22E6A0]">{formatMoney(r.tokenAirdrop)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
