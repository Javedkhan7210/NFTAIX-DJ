import QRCode from "react-qr-code";

type Props = {
  /** Exact address string encoded in the QR (one QR per address). */
  address: string | null;
  size?: number;
};

/** QR encodes the raw wallet address so any scanner reveals that address as plain text. */
export function WalletAddressQr({ address, size = 200 }: Props) {
  if (!address) {
    return (
      <div className="mx-auto flex aspect-square w-[min(220px,72vw)] max-w-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-black/25 px-4 text-center text-sm text-[#8b9bb4]">
        No wallet linked yet. Connect a wallet to show your address QR code.
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-fit flex-col items-center gap-2">
      <div className="rounded-2xl bg-white p-3 shadow-[0_0_24px_rgba(0,209,255,0.15)]">
        <QRCode value={address} size={size} level="M" />
      </div>
      <p className="max-w-[240px] text-center text-[11px] leading-snug text-[#8b9bb4]">
        Scanning displays this wallet address as text ({address.slice(0, 6)}…{address.slice(-4)})
      </p>
    </div>
  );
}
