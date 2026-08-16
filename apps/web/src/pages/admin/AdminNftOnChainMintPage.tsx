import { NavLink } from "react-router-dom";
import { AdminOnChainNftMintPanel } from "./AdminOnChainNftMintPanel";

/** Dedicated page: on-chain NFT supply via Registration + NFTMarketplace. */
export function AdminNftOnChainMintPage() {
  return (
    <div className="space-y-4">
      <NavLink to="/admin/nfts" className="inline-block text-sm text-[#8b9bb4] hover:text-white">
        ← NFTs & activity
      </NavLink>
      <p className="text-sm text-[#8b9bb4]">
        Use the form below to <span className="font-semibold text-white">mint into the public FIFO</span>. Users buy with{" "}
        <span className="font-mono text-white/90">buy()</span> (auto-lists). Force-burn FIFO head from Admin → NFTs.
      </p>
      <AdminOnChainNftMintPanel />
    </div>
  );
}
