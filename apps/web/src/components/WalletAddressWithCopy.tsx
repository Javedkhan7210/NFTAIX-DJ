import { useState } from "react";
import { shortenAddress } from "../lib/formatCrypto";

function IconCopy({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" strokeLinecap="round" />
    </svg>
  );
}

type Props = {
  /** Full 0x address to copy; masked display is derived from this. */
  addressFull: string | null | undefined;
  /** Leading hex chars after 0x (default 6 → e.g. 0xd487…). */
  lead?: number;
  tail?: number;
  emptyLabel?: string;
  className?: string;
  /** Classes for the masked address text (default: white, mono). */
  addressClassName?: string;
  buttonSize?: "sm" | "md";
  wrap?: boolean;
};

/** Masked wallet (e.g. 0xd487…30f6) with copy control — never shows user id or name. */
export function WalletAddressWithCopy({
  addressFull,
  lead = 6,
  tail = 4,
  emptyLabel = "—",
  className = "",
  addressClassName = "truncate font-mono text-sm font-semibold tracking-tight text-white",
  buttonSize = "md",
  wrap = true
}: Props) {
  const [copied, setCopied] = useState(false);

  const display =
    addressFull && /^0x[a-fA-F0-9]{40}$/.test(addressFull.trim())
      ? shortenAddress(addressFull.trim(), lead, tail)
      : emptyLabel;

  const onCopy = async () => {
    if (!addressFull?.trim()) return;
    const value = addressFull.trim();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = value;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.top = "-9999px";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        setCopied(ok);
        if (ok) window.setTimeout(() => setCopied(false), 1600);
      } catch {
        setCopied(false);
      }
    }
  };

  const canCopy = Boolean(addressFull?.trim());
  const btnClass =
    buttonSize === "sm"
      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5 text-[#8b9bb4] transition-colors hover:bg-white/10 hover:text-white"
      : "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#8b9bb4] transition-colors hover:bg-white/10 hover:text-white";
  const iconSize = buttonSize === "sm" ? 14 : 16;

  return (
    <span className={`inline-flex max-w-full items-center gap-2 ${wrap ? "flex-wrap" : "flex-nowrap"} ${className}`}>
      <span className={addressClassName}>{display}</span>
      {canCopy ? (
        <button
          type="button"
          onClick={() => void onCopy()}
          className={btnClass}
          aria-label="Copy wallet address"
        >
          <IconCopy size={iconSize} />
        </button>
      ) : null}
      {copied ? <span className="text-xs font-semibold text-[#22E6A0]">Address copied</span> : null}
    </span>
  );
}
