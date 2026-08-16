/** Pulse placeholders matching neon-card layouts (Tailwind `animate-pulse`). */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/[0.08] ${className}`} />;
}

/** NFT marketplace grid — mirrors `NftCard` in MarketPage. */
export function NftMarketplaceGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading listings"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="neon-card neon-card--inner flex flex-col overflow-hidden p-0"
        >
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-[85%]" />
            <Skeleton className="h-4 w-[55%]" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Trading session + stats on Market page (non-NFT tab). */
export function MarketTradingDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading trading dashboard">
      <section>
        <Skeleton className="mb-2 h-5 w-48" />
        <div className="grid grid-cols-3 gap-2">
          <div className="neon-card neon-card--inner flex flex-col items-center justify-center py-6">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
          <div className="neon-card neon-card--inner flex flex-col items-center justify-center py-6">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
          <div className="neon-card neon-card--inner flex flex-col items-center justify-center py-6">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        </div>
        <Skeleton className="mt-2 h-3 w-full max-w-md" />
      </section>

      <section className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="neon-card neon-card--inner p-4">
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-7 w-32" />
          </div>
        ))}
      </section>

      <div className="neon-card neon-card--inner p-4">
        <Skeleton className="mb-2 h-3 w-40" />
        <Skeleton className="h-7 w-28" />
      </div>

      <div className="flex justify-center gap-2 px-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-px bg-white/10" />
        <Skeleton className="h-4 w-36" />
      </div>
    </div>
  );
}

/** Upgrade / packages tier cards. */
export function PackagesPageSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading packages">
      <div className="neon-card neon-card--inner p-4">
        <Skeleton className="mb-3 h-3 w-28" />
        <Skeleton className="h-6 w-3/4 max-w-xs" />
        <Skeleton className="mt-3 h-4 w-1/2 max-w-[200px]" />
        <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      </div>
      <div className="neon-card neon-card--inner p-4">
        <Skeleton className="mb-3 h-3 w-24" />
        <Skeleton className="h-6 w-2/3 max-w-sm" />
        <Skeleton className="mt-3 h-4 w-40" />
        <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Volume log + compliance rows on trading history. */
export function TradingHistorySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading trading history">
      <Skeleton className="h-5 w-28" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="neon-card p-4">
          <Skeleton className="mb-2 h-4 w-40" />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
      ))}
      <Skeleton className="mt-2 h-5 w-36" />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={`d-${i}`} className="neon-card p-4">
          <Skeleton className="mb-2 h-4 w-56" />
          <Skeleton className="h-3 w-full max-w-sm" />
        </div>
      ))}
    </div>
  );
}

/** Auto Trade “Package & limits” card body. */
export function AutoTradeCardSkeleton() {
  return (
    <div className="mt-2 space-y-3" aria-busy="true" aria-label="Loading auto trade status">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-4 w-3/4 max-w-sm" />
    </div>
  );
}

/** Teams subscription list rows. */
export function TeamsSubscriptionSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading subscriptions">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="neon-card neon-card--inner flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-6 w-16 rounded-lg" />
          </div>
          <Skeleton className="h-3 w-52" />
        </div>
      ))}
    </div>
  );
}

/** Home dashboard top: wallet strip + wave + Direct/Team stats (`DashboardPage` before shortcuts). */
export function HomeDashboardWalletAndStatsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="neon-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-4">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-11 w-full max-w-[280px] rounded-xl" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 sm:items-end">
            <Skeleton className="h-3 w-32 sm:self-end" />
            <div className="flex flex-col gap-2 sm:items-end">
              <Skeleton className="h-9 w-40 sm:self-end" />
              <Skeleton className="h-3 w-48 sm:self-end" />
            </div>
          </div>
        </div>
        <Skeleton className="mt-5 h-[72px] w-full rounded-xl" />
      </div>

      <section className="grid grid-cols-2 gap-3">
        <div className="neon-card neon-card--inner p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-full max-w-[140px]" />
            </div>
          </div>
        </div>
        <div className="neon-card neon-card--inner p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-full max-w-[160px]" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Income page hero card (available total). Parent supplies `neon-card` wrapper. */
export function IncomeHeroSkeleton() {
  return (
    <div className="text-center" aria-busy="true" aria-label="Loading income summary">
      <Skeleton className="mx-auto mb-2 h-3 w-28" />
      <Skeleton className="mx-auto h-10 w-52 max-w-full sm:h-12" />
      <Skeleton className="mx-auto mt-3 h-4 w-44" />
    </div>
  );
}

/** Teams member rows (avatar + text). */
export function TeamsMemberRowSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading team members">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="neon-card flex items-center gap-3 p-3 sm:p-4">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-full max-w-[200px]" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-7 w-10" />
        </div>
      ))}
    </div>
  );
}
