import { useEffect, useMemo, useState } from "react";

function clampPct(n: number | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function ProgressTrack({
  label,
  sublabel,
  pct,
  compact
}: {
  label: string;
  sublabel?: string;
  pct: number;
  compact?: boolean;
}) {
  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`font-semibold uppercase tracking-wide text-[#8b9bb4] ${compact ? "text-[9px]" : "text-[10px]"}`}>
          {label}
        </span>
        <span className={`tabular-nums text-white/90 ${compact ? "text-[10px]" : "text-xs"}`}>{pct.toFixed(0)}%</span>
      </div>
      {sublabel ? <p className="mb-1 text-[9px] text-[#6b7a90]">{sublabel}</p> : null}
      <div className="relative w-full">
        <div
          className={`w-full overflow-hidden rounded-full border border-white/10 bg-black/35 ${compact ? "h-1.5" : "h-2.5"}`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7B2FF7] via-[#00D1FF] to-[#22E6A0] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${label} ${pct.toFixed(0)}%`}
          />
        </div>
        {!compact ? (
          <div
            className="pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 transition-[left] duration-300"
            style={{ left: `${pct}%` }}
            aria-hidden
          >
            <span
              className="block h-4 w-4 -translate-x-1/2 rounded-full border border-white/25 bg-[#00D1FF]"
              style={{ boxShadow: "0 0 14px rgba(0,209,255,0.55), 0 0 22px rgba(138,46,255,0.25)" }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Set true to show daily progress + scale under package bar. */
const SHOW_DAILY_SESSION_BAR = false;

export function MarketTopBar({
  packageUsedPct,
  dailySessionPct,
  periodEndsAt
}: {
  /** 0–100: period volume used vs daily allowance (matches footer). */
  packageUsedPct?: number;
  /** 0–100: current period volume vs required. */
  dailySessionPct?: number;
  /** ISO time when the trading period ends (from API). */
  periodEndsAt?: string;
}) {
  const { label, hours, minutes, seconds } = usePeriodEndCountdown(periodEndsAt);
  const packagePct = clampPct(packageUsedPct);
  const dailyPct = SHOW_DAILY_SESSION_BAR ? clampPct(dailySessionPct) : null;
  const showBars = packagePct != null || dailyPct != null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <h1 className="text-lg font-bold text-white">Market</h1>
        <div className="flex flex-col items-center justify-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8b9bb4]">{label}</span>
          <div
            className="flex items-center gap-1 font-mono tabular-nums leading-none sm:gap-1.5"
            aria-label={`${label} ${hours} hours ${minutes} minutes ${seconds} seconds`}
          >
            <CountdownSegment value={hours} />
            <span className="pb-0.5 text-xl font-bold text-[#5a6d88] sm:text-2xl">:</span>
            <CountdownSegment value={minutes} />
            <span className="pb-0.5 text-xl font-bold text-[#5a6d88] sm:text-2xl">:</span>
            <CountdownSegment value={seconds} />
          </div>
        </div>
        <div />
      </div>

      {showBars ? (
        <div className="flex w-full flex-col gap-2.5">
          {packagePct != null ? (
            <ProgressTrack label="Daily limit" pct={packagePct} />
          ) : null}
          {dailyPct != null ? (
            <ProgressTrack
              label="Period"
              sublabel="Resets when the countdown ends"
              pct={dailyPct}
              compact
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CountdownSegment({ value }: { value: string }) {
  return (
    <span className="min-w-[2.5ch] rounded-lg border border-white/12 bg-black/35 px-2 py-1.5 text-center text-2xl font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:min-w-[2.75ch] sm:px-2.5 sm:py-2 sm:text-3xl">
      {value}
    </span>
  );
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

function splitHms(ms: number): { hours: string; minutes: string; seconds: string } {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return { hours: pad2(h), minutes: pad2(m), seconds: pad2(s) };
}

function usePeriodEndCountdown(periodEndsAt?: string): {
  label: string;
  hours: string;
  minutes: string;
  seconds: string;
} {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return useMemo(() => {
    const endMs = periodEndsAt ? Date.parse(periodEndsAt) : NaN;
    const remaining = Number.isFinite(endMs) ? endMs - now : 0;
    return { label: "Period ends", ...splitHms(remaining) };
  }, [now, periodEndsAt]);
}
