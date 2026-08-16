import { opbnbExplorerAddress } from "../lib/opbnb";

type Props = {
  address: string;
  chainId?: number;
  className?: string;
};

export function ExplorerAddressLink({ address, chainId, className }: Props) {
  const url = opbnbExplorerAddress(address, chainId);
  const short = `${address.slice(0, 8)}…${address.slice(-6)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={address}
      className={className ?? "font-mono text-[#00D1FF] underline hover:text-[#22E6A0]"}
    >
      {short}
    </a>
  );
}
