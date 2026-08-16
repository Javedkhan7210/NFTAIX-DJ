import { useCallback, useEffect, useState } from "react";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { ExplorerTxLink } from "../../components/ExplorerTxLink";
import { AdminOnChainNftMintPanel } from "./AdminOnChainNftMintPanel";

type NftRecordRow = {
  id: string;
  tokenId: string;
  userId: string;
  mintedAt: string;
  isBurned: boolean;
  baseValue?: unknown;
  currentValue?: unknown;
  user?: {
    referralCode?: string;
    walletConnections?: Array<{ walletAddress: string; isPrimary?: boolean }>;
  };
};

type ChainBuyEvent = {
  id: string;
  txHash: string;
  blockNumber: string;
  eventName: string;
  payload: unknown;
};

type ListingRow = {
  id: string;
  tokenNumber: number;
  name: string;
  tier: string;
  priceUsdt: unknown;
  sortOrder: number;
};

export function AdminNftsPage() {
  const [nftRecords, setNftRecords] = useState<NftRecordRow[]>([]);
  const [buyEvents, setBuyEvents] = useState<ChainBuyEvent[]>([]);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState("");
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState("Standard");
  const [newPrice, setNewPrice] = useState("100");
  const [newQty, setNewQty] = useState("1");
  const [newImage, setNewImage] = useState("nft-01.png");
  const [creating, setCreating] = useState(false);
  const [burnTokenId, setBurnTokenId] = useState("");
  const [burnMode, setBurnMode] = useState<"listed" | "force">("force");
  const [burnListedQuote, setBurnListedQuote] = useState<{
    tokenId: string;
    seller: string;
    isSale: boolean;
    listBasePriceWei: string;
    payWei: string;
    payUsdt: string;
  } | null>(null);
  const [burnForceQuote, setBurnForceQuote] = useState<{
    tokenId: string;
    erc721Owner: string;
    marketplaceAddress: string;
    heldByMarketplace: boolean;
    isListedForSale: boolean;
    listingSeller: string | null;
    warning: string | null;
  } | null>(null);
  const [burnLastTx, setBurnLastTx] = useState<string | null>(null);
  const [burnBusy, setBurnBusy] = useState(false);

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const [a, l] = await Promise.all([
        adminService.nftActivity({ limit: 80, userId: filterUser.trim() || undefined }),
        adminService.marketListings()
      ]);
      const ad = a.data as { nftRecords: NftRecordRow[]; chainBuyEvents: ChainBuyEvent[] };
      setNftRecords(ad.nftRecords ?? []);
      setBuyEvents(ad.chainBuyEvents ?? []);
      setListings(l.data as ListingRow[]);
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Load failed."));
    }
  }, [filterUser]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {notice ? (
        <p className="rounded-xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">{notice}</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1 text-xs text-[#8b9bb4]">
          Filter by user id (optional)
          <input
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
            placeholder="cuid…"
          />
        </label>
        <button type="button" className="btn-neon-fill px-4 py-2 text-sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <AdminOnChainNftMintPanel onMintSuccess={() => void load()} />

      <details className="neon-card space-y-3 p-4">
        <summary className="cursor-pointer label-caps text-[#8b9bb4]">
          Legacy DB catalog (optional — not the live market)
        </summary>
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-[#8b9bb4]">
          Rows saved here stay in Postgres only. They do <span className="text-white/85">not</span> mint on-chain and do{" "}
          <span className="text-white/85">not</span> appear on the public NFT tab while the API is in{" "}
          <span className="font-mono text-white/80">source: on-chain</span> mode. Live supply comes from users calling{" "}
          <span className="font-mono text-white/80">buy()</span> in the app (MetaMask on opBNB).
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            placeholder="NFT Name (required for catalog row)"
          />
          <input value={newTier} onChange={(e) => setNewTier(e.target.value)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white" placeholder="Tier" />
          <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white" placeholder="NFT Price (USDT)" />
          <input value={newQty} onChange={(e) => setNewQty(e.target.value)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white" placeholder="Total NFTs (Quantity)" />
          <input value={newImage} onChange={(e) => setNewImage(e.target.value)} className="sm:col-span-2 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white" placeholder="Image file (e.g. nft-01.png)" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={creating}
            onClick={async () => {
              const qty = Math.max(1, Number(newQty) || 1);
              const price = Number(newPrice);
              if (!newName.trim()) {
                setNotice("Catalog row needs a name in the first field.");
                return;
              }
              if (!Number.isFinite(price) || price <= 0) {
                setNotice("Enter a valid price greater than 0.");
                return;
              }
              setCreating(true);
              setNotice(null);
              try {
                for (let i = 1; i <= qty; i++) {
                  await adminService.createMarketListing({
                    name: qty === 1 ? newName.trim() : `${newName.trim()} #${i}`,
                    tier: newTier.trim() || "Standard",
                    priceUsdt: price,
                    imageFile: newImage.trim() || undefined
                  });
                }
                setNotice(`Saved ${qty} DB catalog row(s). Public Market still uses on-chain FIFO.`);
                setNewName("");
                await load();
              } catch (e) {
                setNotice(getApiErrorMessage(e, "Create catalog row failed."));
              } finally {
                setCreating(false);
              }
            }}
          >
            {creating ? "Saving…" : "Save DB catalog row(s)"}
          </button>
        </div>
      </details>

      <div className="neon-card space-y-3 p-4">
        <p className="label-caps">Burn NFT (on-chain)</p>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <label className="flex cursor-pointer items-center gap-2 text-[#c8d4e6]">
            <input
              type="radio"
              name="burnMode"
              checked={burnMode === "force"}
              onChange={() => {
                setBurnMode("force");
                setBurnListedQuote(null);
                setBurnForceQuote(null);
                setBurnLastTx(null);
              }}
            />
            <span>
              <strong className="text-white">Force burn</strong> — any minted id (user wallet or marketplace escrow). No USDT; uses{" "}
              <span className="font-mono">burnNftId</span>.
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[#c8d4e6]">
            <input
              type="radio"
              name="burnMode"
              checked={burnMode === "listed"}
              onChange={() => {
                setBurnMode("listed");
                setBurnListedQuote(null);
                setBurnForceQuote(null);
                setBurnLastTx(null);
              }}
            />
            <span>
              <strong className="text-white">Listed burn</strong> — only when <span className="font-mono">isSale</span>; pays seller USDT via{" "}
              <span className="font-mono">burnNftFromOwner</span>.
            </span>
          </label>
        </div>
        {/* <p className="text-[11px] leading-relaxed text-[#8b9bb4]">
          Signing wallet: <span className="font-mono">MARKETPLACE_OWNER_PRIVATE_KEY</span> must equal marketplace <span className="font-mono">owner()</span>.
          {burnMode === "force" ? (
            <>
              {" "}
              If a listing is still open, force-burn skips payouts and can leave stale marketplace state — use Listed burn to settle the sale.
            </>
          ) : null}
        </p> */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[160px] flex-1 text-xs text-[#8b9bb4]">
            On-chain token id
            <input
              value={burnTokenId}
              onChange={(e) => {
                setBurnTokenId(e.target.value);
                setBurnListedQuote(null);
                setBurnForceQuote(null);
                setBurnLastTx(null);
              }}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white"
              placeholder="e.g. 42"
            />
          </label>
          <button
            type="button"
            className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10"
            disabled={burnBusy}
            onClick={async () => {
              setNotice(null);
              setBurnLastTx(null);
              if (!burnTokenId.trim()) {
                setNotice("Enter a token id.");
                return;
              }
              setBurnBusy(true);
              try {
                if (burnMode === "listed") {
                  const res = await adminService.nftOnChainBurnListedQuote(burnTokenId.trim());
                  setBurnListedQuote(res.data);
                  setBurnForceQuote(null);
                } else {
                  const res = await adminService.nftOnChainForceBurnQuote(burnTokenId.trim());
                  setBurnForceQuote(res.data);
                  setBurnListedQuote(null);
                }
              } catch (e) {
                setNotice(getApiErrorMessage(e, "Quote failed."));
                setBurnListedQuote(null);
                setBurnForceQuote(null);
              } finally {
                setBurnBusy(false);
              }
            }}
          >
            Preview
          </button>
          <button
            type="button"
            className="btn-neon-fill px-4 py-2 text-sm"
            disabled={burnBusy}
            onClick={async () => {
              setNotice(null);
              if (!burnTokenId.trim()) {
                setNotice("Enter a token id.");
                return;
              }
              const id = burnTokenId.trim();
              if (burnMode === "listed") {
                if (
                  !window.confirm(
                    `Listed burn NFT #${id}? This sends a chain tx from the marketplace owner wallet and pays the seller (USDT).`
                  )
                ) {
                  return;
                }
                setBurnBusy(true);
                try {
                  const res = await adminService.nftOnChainBurnListed({ tokenId: id });
                  setBurnLastTx(res.data.txHash);
                  setNotice("Listed burn transaction submitted.");
                  setBurnListedQuote(null);
                  await load();
                } catch (e) {
                  setNotice(getApiErrorMessage(e, "Burn failed."));
                } finally {
                  setBurnBusy(false);
                }
              } else {
                const extra =
                  burnForceQuote?.isListedForSale === true
                    ? "\n\nWARNING: This token is still listed for sale — the seller will NOT receive USDT. Prefer “Listed burn” unless you accept that."
                    : "";
                if (!window.confirm(`Force burn NFT #${id}? The token will be destroyed. No USDT is sent to anyone.${extra}`)) {
                  return;
                }
                setBurnBusy(true);
                try {
                  const res = await adminService.nftOnChainForceBurn({ tokenId: id });
                  setBurnLastTx(res.data.txHash);
                  setNotice("Force burn transaction submitted.");
                  setBurnForceQuote(null);
                  await load();
                } catch (e) {
                  setNotice(getApiErrorMessage(e, "Force burn failed."));
                } finally {
                  setBurnBusy(false);
                }
              }
            }}
          >
            {burnBusy ? "Working…" : burnMode === "listed" ? "Burn (pay seller)" : "Force burn"}
          </button>
        </div>
        {burnListedQuote ? (
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-[#c8d4e6]">
            <div>
              Seller: <span className="text-emerald-200/90">{burnListedQuote.seller}</span>
            </div>
            <div>Pay from owner wallet: {burnListedQuote.payUsdt} USDT</div>
            <div className="text-[#8b9bb4]">Listed base (wei): {burnListedQuote.listBasePriceWei}</div>
          </div>
        ) : null}
        {burnForceQuote ? (
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-[#c8d4e6]">
            <div>
              ERC721 holder: <span className="text-sky-200/90">{burnForceQuote.erc721Owner}</span>
            </div>
            <div>Marketplace: {burnForceQuote.marketplaceAddress}</div>
            <div>Held by marketplace contract: {burnForceQuote.heldByMarketplace ? "yes" : "no"}</div>
            <div>Listed for sale (marketplace): {burnForceQuote.isListedForSale ? "yes" : "no"}</div>
            {burnForceQuote.listingSeller ? (
              <div>
                Listing seller field: <span className="text-amber-200/90">{burnForceQuote.listingSeller}</span>
              </div>
            ) : null}
            {burnForceQuote.warning ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-200/95">{burnForceQuote.warning}</p>
            ) : null}
          </div>
        ) : null}
        {burnLastTx ? (
          <p className="text-xs text-[#8b9bb4]">
            Tx: <ExplorerTxLink txHash={burnLastTx} />
          </p>
        ) : null}
      </div>

      <div className="neon-card overflow-x-auto p-3">
        <p className="label-caps mb-2">NFT records (app DB)</p>
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="text-[#8b9bb4]">
              <th className="p-2">User ID</th>
              <th className="p-2">Wallet</th>
              <th className="p-2">Token</th>
              <th className="p-2">User / wallet</th>
              <th className="p-2">Minted</th>
              <th className="p-2">Burned</th>
              <th className="p-2">Values</th>
            </tr>
          </thead>
          <tbody>
            {nftRecords.map((r) => {
              const w = r.user?.walletConnections?.find((x) => x.isPrimary) ?? r.user?.walletConnections?.[0];
              return (
                <tr key={r.id} className="border-t border-white/5 font-mono text-[11px]">
                  <td className="p-2 text-white">{r.userId}</td>
                  <td className="p-2 text-[#8b9bb4]">{w?.walletAddress ?? "—"}</td>
                  <td className="p-2 text-white">{r.tokenId}</td>
                  <td className="max-w-[220px] p-2 text-[#8b9bb4]">
                    <span className="block truncate text-white">{r.userId}</span>
                    {r.user?.referralCode ? <span className="text-[10px]">ref {r.user.referralCode}</span> : null}
                    {w?.walletAddress ? (
                      <span className="block truncate">{w.walletAddress}</span>
                    ) : null}
                  </td>
                  <td className="p-2">{new Date(r.mintedAt).toLocaleString()}</td>
                  <td className="p-2">{r.isBurned ? "yes" : "no"}</td>
                  <td className="p-2 text-[#8b9bb4]">
                    base {String(r.baseValue ?? "—")} · cur {String(r.currentValue ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="neon-card overflow-x-auto p-3">
        <p className="label-caps mb-2">On-chain buy events (indexed)</p>
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr className="text-[#8b9bb4]">
              <th className="p-2">Status</th>
              <th className="p-2">User ID</th>
              <th className="p-2">Wallet</th>
              <th className="p-2">NFT ID</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Tx</th>
              <th className="p-2">Block</th>
              <th className="p-2">Event</th>
              <th className="p-2">Payload (truncated)</th>
            </tr>
          </thead>
          <tbody>
            {buyEvents.map((e) => (
              <tr key={e.id} className="border-t border-white/5 font-mono text-[11px]">
                <td className="p-2 text-emerald-300">Success</td>
                <td className="p-2 text-[#8b9bb4]">—</td>
                <td className="p-2 text-[#8b9bb4]">{String((e.payload as { user?: unknown })?.user ?? "—")}</td>
                <td className="p-2 text-white">{String((e.payload as { tokenId?: unknown })?.tokenId ?? "—")}</td>
                <td className="p-2 text-[#8b9bb4]">{String((e.payload as { amount?: unknown })?.amount ?? "—")}</td>
                <td className="p-2">
                  <ExplorerTxLink txHash={e.txHash} />
                </td>
                <td className="p-2 text-[#8b9bb4]">{e.blockNumber}</td>
                <td className="p-2">{e.eventName}</td>
                <td className="max-w-md truncate p-2 text-[#8b9bb4]">{JSON.stringify(e.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="neon-card overflow-x-auto p-3">
        <p className="label-caps mb-2">DB catalog rows (fallback only — not live FIFO)</p>
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="text-[#8b9bb4]">
              <th className="p-2">#</th>
              <th className="p-2">Name</th>
              <th className="p-2">Tier</th>
              <th className="p-2">USDT</th>
              <th className="p-2">Sort</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="p-2 font-mono text-white">{r.tokenNumber}</td>
                <td className="p-2">{r.name}</td>
                <td className="p-2">{r.tier}</td>
                <td className="p-2 font-mono">{String(r.priceUsdt)}</td>
                <td className="p-2">{r.sortOrder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[#8b9bb4]">
        Contract deployments and proxy upgrades stay in Hardhat + env. This view is DB + indexer only.
      </p>
    </div>
  );
}

//old code