import { opbnbExplorerTx } from "../lib/opbnb";

type Props = {
  txHash: string;
  /** Plain hash snippet shown next to the link */
  showHash?: boolean;
  className?: string;
};

export function ExplorerTxLink({ txHash, showHash = true, className }: Props) {
  const url = opbnbExplorerTx(txHash);
  const short = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={className ?? "text-[#00D1FF] underline"}>
      {showHash ? short : "View on explorer"}
    </a>
  );
}
