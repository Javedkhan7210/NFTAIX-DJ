/**
 * Admin on-chain mint — seeds NFTMarketplace FIFO via owner `adminMintToQueue`.
 */
import { useEffect, useState } from "react";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { ExplorerTxLink } from "../../components/ExplorerTxLink";

export type AdminOnChainNftMintPanelProps = {
  onMintSuccess?: () => void;
};

export function AdminOnChainNftMintPanel({ onMintSuccess }: AdminOnChainNftMintPanelProps) {
  const [quantity, setQuantity] = useState("1");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [lastTokenIds, setLastTokenIds] = useState<string[]>([]);
  const [quote, setQuote] = useState<{
    unitPriceUsdt: string;
    totalUsdt: string;
    queueLength: string;
    burnThresholdUsdt?: string;
  } | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [marketplace, setMarketplace] = useState<string | null>(null);

  const refreshMeta = async () => {
    try {
      const [defaults, pre] = await Promise.all([
        adminService.nftOnChainMintDefaults(),
        adminService.nftOnChainMintPreflight()
      ]);
      setMarketplace(defaults.marketplace ?? defaults.marketplaceOwner ?? null);
      setReady(pre.data.ready);
      setIssues(pre.data.issues ?? []);
    } catch (e) {
      setReady(false);
      setIssues([getApiErrorMessage(e, "Could not load mint defaults.")]);
    }
    const qty = Math.max(1, Number(quantity) || 1);
    try {
      const q = await adminService.nftOnChainMintQuote(qty);
      setQuote({
        unitPriceUsdt: q.data.unitPriceUsdt,
        totalUsdt: q.data.totalUsdt,
        queueLength: (q.data as { queueLength?: string }).queueLength ?? "—",
        burnThresholdUsdt: (q.data as { burnThresholdUsdt?: string }).burnThresholdUsdt
      });
    } catch (e) {
      setQuote(null);
      setNotice(getApiErrorMessage(e, "Quote failed."));
    }
  };

  useEffect(() => {
    void refreshMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const qty = Math.max(1, Number(quantity) || 1);
      void adminService
        .nftOnChainMintQuote(qty)
        .then((q) => {
          setQuote({
            unitPriceUsdt: q.data.unitPriceUsdt,
            totalUsdt: q.data.totalUsdt,
            queueLength: (q.data as { queueLength?: string }).queueLength ?? "—",
            burnThresholdUsdt: (q.data as { burnThresholdUsdt?: string }).burnThresholdUsdt
          });
        })
        .catch(() => setQuote(null));
    }, 300);
    return () => window.clearTimeout(t);
  }, [quantity]);

  const onMint = async () => {
    const qty = Math.max(1, Math.min(50, Number(quantity) || 1));
    setBusy(true);
    setNotice(null);
    setLastTx(null);
    setLastTokenIds([]);
    try {
      const res = await adminService.nftAdminMintPrimaryFree({
        quantity: qty,
        label: label.trim() || undefined
      });
      const tx = res.data.mintTxHash;
      setLastTx(tx);
      setLastTokenIds(res.data.tokenIds ?? []);
      setNotice(
        `Minted ${res.data.tokenIds?.length ?? qty} NFT(s) into the on-chain sell queue. Public Market → NFT will show them.`
      );
      await refreshMeta();
      onMintSuccess?.();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "On-chain mint failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="neon-card space-y-3 p-4" id="admin-on-chain-mint">
      <p className="label-caps">Mint NFT on-chain (FIFO queue)</p>
      <p className="rounded-xl border border-emerald-400/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-50/95">
        Owner call <span className="font-mono text-white">adminMintToQueue</span> — no USDT. Each NFT lists at{" "}
        <span className="font-semibold text-white">mint price +10%</span> (e.g. $10 → <span className="text-white">$11</span>
        ). User buys still auto-list with appreciation.
      </p>

      {ready === false ? (
        <ul className="rounded-lg border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-100">
          {issues.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
      ) : null}

      {marketplace ? (
        <p className="font-mono text-[10px] text-[#8b9bb4]">
          Marketplace {marketplace.slice(0, 10)}…{marketplace.slice(-8)}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-[#8b9bb4]">
          Quantity (1–50)
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            inputMode="numeric"
          />
        </label>
        <label className="text-[11px] text-[#8b9bb4]">
          Label (admin log only)
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            placeholder="optional note"
          />
        </label>
      </div>

      {quote ? (
        <p className="text-[11px] text-[#c5d0e0]">
          Next ask <span className="font-mono text-white">${quote.unitPriceUsdt}</span>
          {" · "}
          Ladder total ≈ <span className="font-mono text-white">${quote.totalUsdt}</span>
          {" · "}
          Queue now <span className="font-mono text-white">{quote.queueLength}</span>
          {quote.burnThresholdUsdt ? (
            <>
              {" · "}
              Burn @ <span className="font-mono text-white">${quote.burnThresholdUsdt}</span>
            </>
          ) : null}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-neon-fill px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || ready === false}
        onClick={() => void onMint()}
      >
        {busy ? "Minting on-chain…" : "Mint to public sell queue"}
      </button>

      {notice ? <p className="text-sm text-amber-100">{notice}</p> : null}
      {lastTx ? (
        <p className="text-[11px] text-[#8b9bb4]">
          Tx <ExplorerTxLink txHash={lastTx} />
          {lastTokenIds.length ? (
            <>
              {" · "}
              Tokens {lastTokenIds.map((t) => `#${t}`).join(", ")}
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
