import { motion } from "framer-motion";

export type MarketNavMode = "market" | "nft" | "my-nfts" | "history";

type MarketQuadNavProps = {
  mode: MarketNavMode;
  onMarket: () => void;
  onNft: () => void;
  onMyNfts: () => void;
  onTradingHistory: () => void;
};

const tileActive =
  "tab-pill tab-pill--active flex min-h-[52px] items-center justify-center rounded-[22px] px-3 py-3 text-center text-[15px] font-semibold text-white shadow-[0_0_18px_rgba(123,47,247,0.35)]";

const tileInactive =
  "flex min-h-[52px] items-center justify-center rounded-[22px] border border-[rgba(0,198,255,0.55)] bg-transparent px-3 py-3 text-center text-[15px] font-semibold text-white shadow-[0_0_16px_rgba(123,47,247,0.22)] transition hover:border-[#00D1FF] hover:shadow-[0_0_20px_rgba(0,209,255,0.25)]";

export function MarketQuadNav({ mode, onMarket, onNft, onMyNfts, onTradingHistory }: MarketQuadNavProps) {
  const marketOn = mode === "market";
  const nftOn = mode === "nft";
  const myNftsOn = mode === "my-nfts";
  const historyOn = mode === "history";
  const goMarket = onMarket ?? (() => {});

  return (
    <div className="mb-4 grid grid-cols-2 gap-3" role="tablist" aria-label="Market navigation">
      <motion.button
        type="button"
        role="tab"
        aria-selected={marketOn}
        className={marketOn ? tileActive : tileInactive}
        onClick={goMarket}
        whileTap={{ scale: 0.98 }}
      >
        Session
      </motion.button>
      <motion.button
        type="button"
        role="tab"
        aria-selected={nftOn}
        className={nftOn ? tileActive : tileInactive}
        onClick={onNft}
        whileTap={{ scale: 0.98 }}
      >
        NFT
      </motion.button>
      <motion.button
        type="button"
        role="tab"
        aria-selected={myNftsOn}
        className={myNftsOn ? tileActive : tileInactive}
        onClick={onMyNfts}
        whileTap={{ scale: 0.98 }}
      >
        My NFTs
      </motion.button>
      <motion.button
        type="button"
        role="tab"
        aria-selected={historyOn}
        className={historyOn ? tileActive : tileInactive}
        onClick={onTradingHistory}
        whileTap={{ scale: 0.98 }}
      >
        History
      </motion.button>
    </div>
  );
}
