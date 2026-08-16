import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MobileShell } from "../components/MobileShell";
import { PackagesPageSkeleton } from "../components/SkeletonLoaders";
import { SubScreenHeader } from "../components/SubScreenHeader";
import { useAuth } from "../context/AuthContext";
import { getApiErrorMessage } from "../lib/getApiErrorMessage";
import { formatMoney } from "../lib/formatCrypto";
import { opbnbExplorerTx } from "../lib/opbnb";
import { approveAndActivateOrUpgrade } from "../lib/onChainSubscription";
import { zeroAddress, type Address } from "viem";
import { baseURL } from "../api/client";
import { chainService, registrationAddressFromStatus } from "../services/chainService";
import { syncPackageActivationIfNeeded } from "../lib/syncPackageActivation";
import { packageService, type SubscriptionViewDto } from "../services/packageService";
import {
  PACKAGE_USD,
  checkRegistrationActivateGate,
  getConnectedWalletAddress,
  type RegistrationActivateGate
} from "../lib/registrationPreflight";

/** Labels for UI steps; indices align with Registration packages starting at $5 entry */
const ENTRY_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

function stepLabelForAmount(amount: number): string | null {
  const i = ENTRY_STEPS.indexOf(amount as (typeof ENTRY_STEPS)[number]);
  if (i === -1) return null;
  if (i === 0) return "Registration entry";
  return `Upgrade step ${i + 1}`;
}

type TierRow = NonNullable<SubscriptionViewDto["current"]>;

function IconIncomeNav() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 18V6M4 18h16M8 14l4-4 4 4M12 6v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTeamsNav() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M3 19v-1a5 5 0 015-5h1M16 13a5 5 0 015 5v1" strokeLinecap="round" />
    </svg>
  );
}

function amt(v: string | number): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function TierCard({
  role,
  tier,
  hasFullAccess,
  nextElig,
  activating,
  insufficientBalance,
  custodialActivationsEnabled,
  onActivate
}: {
  role: "current" | "next";
  tier: TierRow;
  hasFullAccess: boolean;
  nextElig: { eligible: boolean; reason: string } | null;
  activating: boolean;
  insufficientBalance: boolean;
  custodialActivationsEnabled: boolean;
  onActivate: () => void;
}) {
  const price = amt(tier.activationAmount);
  const step = stepLabelForAmount(price);
  const highlight = tier.isBaseEntry;
  const showElig = role === "next" && nextElig;
  const deltaNote =
    role === "next"
      ? custodialActivationsEnabled
        ? "Upgrade charge is the difference from your active tier (custodial USDT)."
        : "Upgrade charge is the difference from your active tier (paid from your wallet on-chain)."
      : null;

  return (
    <motion.div
      className={`neon-card p-4 ${highlight ? "ring-1 ring-[#00D1FF]/40" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label-caps text-[10px] text-[#8b9bb4]">{role === "current" ? "Active package" : "Next step"}</p>
          <p className="text-lg font-bold text-white">{tier.name}</p>
          <p className="mt-0.5 font-mono text-[#22E6A0]">{formatMoney(price)}</p>
          {step ? <p className="mt-1 text-[11px] font-medium text-[#00D1FF]/90">{step}</p> : null}
        </div>
        {highlight ? (
          <span className="rounded-lg bg-[#8A2EFF]/25 px-2 py-0.5 text-[10px] font-bold uppercase text-[#c4a5ff]">
            Registration
          </span>
        ) : null}
      </div>
      {deltaNote ? <p className="mt-2 text-[11px] text-[#8b9bb4]">{deltaNote}</p> : null}
      {showElig ? (
        <p className={`mt-2 text-xs ${nextElig!.eligible ? "text-[#22E6A0]" : "text-amber-200/90"}`}>
          Eligibility: {nextElig!.reason}
          {nextElig!.eligible ? " · OK" : ""}
        </p>
      ) : null}
      {role === "current" ? (
        <p className="mt-4 text-sm font-medium text-[#22E6A0]">Currently activated</p>
      ) : custodialActivationsEnabled ? (
        <motion.button
          type="button"
          className="btn-neon-fill mt-4 w-full py-3 text-[14px] font-semibold disabled:opacity-50"
          whileTap={{ scale: 0.98 }}
          disabled={
            activating ||
            !hasFullAccess ||
            insufficientBalance ||
            (nextElig !== null && !nextElig.eligible)
          }
          onClick={onActivate}
        >
          {activating
            ? "Processing…"
            : !hasFullAccess
              ? "Connect wallet to upgrade"
              : insufficientBalance
                ? "Insufficient USDT"
                : nextElig !== null && !nextElig.eligible
                  ? "Not eligible yet"
                  : "Pay & activate"}
        </motion.button>
      ) : (
        <p className="mt-4 rounded-xl border border-[#00D1FF]/25 bg-[#0a1520]/80 px-3 py-3 text-center text-xs leading-snug text-[#a8b8c8]">
          Packages are on-chain only. Use <span className="font-semibold text-[#00D1FF]">Activate with wallet</span> below.
        </p>
      )}
    </motion.div>
  );
}

function tierForPackageUsd(allTiers: TierRow[], usd: number): TierRow | null {
  const exact = allTiers.find((t) => amt(t.activationAmount) === usd);
  return exact ?? null;
}

export function UpgradePage() {
  const navigate = useNavigate();
  const { hasFullAccess } = useAuth();
  const [view, setView] = useState<SubscriptionViewDto | null>(null);
  const [allTiers, setAllTiers] = useState<TierRow[]>([]);
  const [packageGate, setPackageGate] = useState<RegistrationActivateGate | null>(null);
  const [packageGateLoading, setPackageGateLoading] = useState(false);
  const [nextElig, setNextElig] = useState<{ eligible: boolean; reason: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [onChainBusy, setOnChainBusy] = useState(false);
  const [chainReady, setChainReady] = useState(false);
  const [chainMissingEnv, setChainMissingEnv] = useState<string[]>([]);
  const [chainStatusError, setChainStatusError] = useState<string | null>(null);
  const [onChainTx, setOnChainTx] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [vRes, tRes] = await Promise.all([
      packageService.subscriptionView(),
      packageService.listTiers()
    ]);
    let viewData = vRes.data;
    if (!viewData.current) {
      await syncPackageActivationIfNeeded();
      const vAgain = await packageService.subscriptionView();
      viewData = vAgain.data;
    }
    setView(viewData);
    setAllTiers((tRes.data as TierRow[]) ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotice(null);
      try {
        await load();
      } catch {
        if (!cancelled) setNotice("Could not load packages.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    chainService
      .status()
      .then((r) => {
        setChainStatusError(null);
        setChainReady(Boolean(r.data.onChainUiReady));
        setChainMissingEnv(r.data.missingOnChainConfig ?? []);
      })
      .catch((err) => {
        setChainReady(false);
        setChainMissingEnv([]);
        setChainStatusError(getApiErrorMessage(err, "Request failed."));
      });
  }, []);

  /** Read Registration so “Next step” matches activate/upgrade package id when the indexer lags. */
  useEffect(() => {
    let cancelled = false;
    if (!chainReady || !hasFullAccess) {
      setPackageGate(null);
      setPackageGateLoading(false);
      return;
    }
    void (async () => {
      setPackageGateLoading(true);
      try {
        const status = await chainService.status();
        const registrationAddr = registrationAddressFromStatus(status.data);
        if (!registrationAddr || cancelled) {
          setPackageGate(null);
          return;
        }
        const wallet = await getConnectedWalletAddress();
        if (!wallet || cancelled) {
          setPackageGate(null);
          return;
        }
        const gate = await checkRegistrationActivateGate(registrationAddr as Address, wallet);
        if (!cancelled) setPackageGate(gate);
      } catch {
        if (!cancelled) setPackageGate(null);
      } finally {
        if (!cancelled) setPackageGateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chainReady, hasFullAccess]);

  const effectiveCurrentTier: TierRow | null =
    view?.current ??
    (packageGate && packageGate.ok && packageGate.currentOnChainLevel > 0 && allTiers.length
      ? tierForPackageUsd(allTiers, PACKAGE_USD[packageGate.currentOnChainLevel - 1])
      : null);

  const effectiveNextTier: TierRow | null = (() => {
    if (packageGate && !packageGate.ok) return null;
    if (packageGate && packageGate.ok && allTiers.length > 0) {
      const needUsd = PACKAGE_USD[packageGate.requiredLevel - 1];
      const fromChain = tierForPackageUsd(allTiers, needUsd);
      if (fromChain) return fromChain;
    }
    return view?.next ?? null;
  })();

  useEffect(() => {
    if (!effectiveNextTier) {
      setNextElig(null);
      return;
    }
    let cancelled = false;
    packageService
      .upgradeEligibility(amt(effectiveNextTier.activationAmount))
      .then((r) => {
        if (!cancelled) setNextElig(r.data as { eligible: boolean; reason: string });
      })
      .catch(() => {
        if (!cancelled) setNextElig({ eligible: false, reason: "Could not check eligibility." });
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveNextTier?.id]);

  const balance = view ? parseFloat(view.custodialUsdtBalance) : 0;
  const custodialActivationsEnabled = Boolean(view?.custodialActivationsEnabled);

  const upgradeDelta =
    effectiveCurrentTier && effectiveNextTier
      ? Math.max(0, amt(effectiveNextTier.activationAmount) - amt(effectiveCurrentTier.activationAmount))
      : 0;
  const insufficientForNext =
    custodialActivationsEnabled && effectiveNextTier && upgradeDelta > 0 && balance < upgradeDelta;

  const onActivateNext = async () => {
    if (!custodialActivationsEnabled || !effectiveNextTier || !hasFullAccess) return;
    setNotice(null);
    if (nextElig && !nextElig.eligible) {
      setNotice(nextElig.reason || "Not eligible for this tier.");
      return;
    }
    if (insufficientForNext) {
      setNotice(
        `Insufficient custodial USDT. Need ${formatMoney(upgradeDelta)} for this upgrade; you have ${formatMoney(balance)}.`
      );
      return;
    }
    setActivating(true);
    try {
      await packageService.activate(effectiveNextTier.id);
      await load();
      setNotice(`Upgraded to ${effectiveNextTier.name}.`);
    } catch (err) {
      setNotice(getApiErrorMessage(err, "Activation failed."));
    } finally {
      setActivating(false);
    }
  };

  const onActivateOnChain = async () => {
    if (!effectiveNextTier || !hasFullAccess) return;
    setNotice(null);
    setOnChainTx(null);
    if (nextElig && !nextElig.eligible) {
      setNotice(nextElig.reason || "Not eligible for this tier.");
      return;
    }
    let status: Awaited<ReturnType<typeof chainService.status>>;
    try {
      status = await chainService.status();
    } catch {
      setNotice("Could not read chain configuration from API.");
      return;
    }
    const registrationAddr = registrationAddressFromStatus(status.data);
    const usdt = status.data.usdt;
    if (!status.data.configured || !registrationAddr || !usdt) {
      setNotice(
        "On-chain contracts are not configured (set API REGISTRATION_CONTRACT_ADDRESS and USDT_CONTRACT_ADDRESS)."
      );
      return;
    }
    setOnChainBusy(true);
    try {
      const ctxRes = await packageService.onChainContext();
      const ctx = ctxRes.data;
      const tierUsd = amt(effectiveNextTier.activationAmount);
      const levelIdx = PACKAGE_USD.indexOf(tierUsd as (typeof PACKAGE_USD)[number]);
      if (levelIdx === -1) {
        setNotice("This tier amount must match a Registration package ($5 … $10000). Adjust PackageTier seed data.");
        return;
      }
      const level = levelIdx + 1;
      const sponsor = /^0x[a-fA-F0-9]{40}$/.test(ctx.sponsorWallet) ? ctx.sponsorWallet : zeroAddress;
      const ref =
        sponsor !== zeroAddress ? sponsor : /^0x[a-fA-F0-9]{40}$/.test(ctx.defaultReferrerWallet) ? ctx.defaultReferrerWallet : zeroAddress;
      if (ref === zeroAddress) {
        setNotice("Missing sponsor or default Registration sponsor.");
        return;
      }

      const wallet = await getConnectedWalletAddress();
      if (!wallet) {
        setNotice("Connect your wallet first.");
        return;
      }
      const gate = await checkRegistrationActivateGate(registrationAddr as Address, wallet);
      if (!gate.ok) {
        setNotice(gate.message);
        return;
      }
      if (level !== gate.requiredLevel) {
        const needUsd = PACKAGE_USD[gate.requiredLevel - 1];
        setNotice(
          `On-chain your next step must be package ${gate.requiredLevel} ($${needUsd}). You tried package ${level} ($${tierUsd}). ` +
            (gate.currentOnChainLevel === 0
              ? "New wallets must activate package 1 first."
              : `This wallet is already on package ${gate.currentOnChainLevel} on-chain; upgrade one step at a time.`)
        );
        return;
      }

      const hash = await approveAndActivateOrUpgrade({
        registration: registrationAddr as Address,
        usdt: usdt as Address,
        referrer: ref as Address,
        level
      });
      setOnChainTx(hash);
      setNotice("Transaction sent — waiting for indexer…");
      const maxWait = 120_000;
      const t0 = Date.now();
      let indexed = false;
      while (Date.now() - t0 < maxWait) {
        const look = await chainService.activation(hash);
        if (look.data.activation) {
          indexed = true;
          setNotice("Indexed on-chain activation.");
          await load();
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!indexed) {
        setNotice("Tx sent but activation not indexed yet — check again shortly.");
      }
    } catch (err) {
      setNotice(getApiErrorMessage(err, "On-chain activation failed."));
    } finally {
      setOnChainBusy(false);
    }
  };

  return (
    <MobileShell>
      <SubScreenHeader />

      {notice ? (
        <p className="mb-3 rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{notice}</p>
      ) : null}

      <h1 className="mb-4 text-2xl font-bold tracking-tight text-white">Packages</h1>

      {loading ? (
        <PackagesPageSkeleton />
      ) : (
        <div className="flex flex-col gap-3">
          {effectiveCurrentTier ? (
            <TierCard
              role="current"
              tier={effectiveCurrentTier}
              hasFullAccess={hasFullAccess}
              nextElig={null}
              activating={false}
              insufficientBalance={false}
              custodialActivationsEnabled={custodialActivationsEnabled}
              onActivate={() => {}}
            />
          ) : (
            <p className="text-sm text-amber-200/90">
              {custodialActivationsEnabled
                ? "No active package found. Contact support if you just registered."
                : packageGateLoading
                  ? "Checking on-chain package…"
                  : "No indexed activation yet. After your wallet transaction confirms, the indexer will show your tier here — use “Activate with wallet” below."}
            </p>
          )}

          {!view?.current && packageGate && packageGate.ok && packageGate.currentOnChainLevel > 0 ? (
            <p className="rounded-2xl border border-[#00D1FF]/25 bg-[#0a1520]/80 px-3 py-2 text-xs text-[#a8b8c8]">
              On-chain you are on package {packageGate.currentOnChainLevel} (
              {formatMoney(PACKAGE_USD[packageGate.currentOnChainLevel - 1])} USDT). The packages card above reflects
              this until the indexer catches up.
            </p>
          ) : null}

          {packageGate && !packageGate.ok ? (
            <p className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
              {packageGate.message}
            </p>
          ) : null}

          {effectiveNextTier ? (
            <>
              {packageGateLoading && chainReady && hasFullAccess ? (
                <p className="text-[11px] text-[#8b9bb4]">
                  Reading your package from Registration (so the next activate/upgrade step is correct)…
                </p>
              ) : null}
              {insufficientForNext ? (
                <p className="rounded-2xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                  Need {formatMoney(upgradeDelta)} USDT for this upgrade (custodial balance {formatMoney(balance)}).
                </p>
              ) : null}
              <TierCard
                role="next"
                tier={effectiveNextTier}
                hasFullAccess={hasFullAccess}
                nextElig={nextElig}
                activating={activating}
                insufficientBalance={!!insufficientForNext}
                custodialActivationsEnabled={custodialActivationsEnabled}
                onActivate={onActivateNext}
              />
              <div className="neon-card mt-2 p-4">
                <p className="label-caps mb-2 text-[10px] text-[#8b9bb4]">On-chain (wallet token)</p>
                <p className="mb-3 text-xs text-[#a8b8c8]">
                  Pay from your wallet on opBNB: approve USDT for the Registration contract, then call{" "}
                  <span className="font-mono text-white/70">activate</span> or{" "}
                  <span className="font-mono text-white/70">upgrade</span>. Requires API contract env + indexer.
                </p>
                {onChainTx ? (
                  <a
                    href={opbnbExplorerTx(onChainTx)}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-3 block text-xs font-mono text-[#00D1FF] underline"
                  >
                    View tx
                  </a>
                ) : null}
                <motion.button
                  type="button"
                  className="btn-neon-ghost w-full py-3 text-[14px] font-semibold disabled:opacity-50"
                  whileTap={{ scale: 0.98 }}
                  disabled={
                    onChainBusy ||
                    !hasFullAccess ||
                    !chainReady ||
                    (nextElig !== null && !nextElig.eligible)
                  }
                  onClick={() => void onActivateOnChain()}
                >
                  {onChainBusy ? "Confirm in wallet…" : "Activate with wallet (on-chain)"}
                </motion.button>
                {!chainReady ? (
                  <div className="mt-2 space-y-1 text-[11px] text-amber-200/80">
                    {chainMissingEnv.length ? (
                      <p>
                        Set in apps/api/.env, then restart the API: {chainMissingEnv.join(", ")}. Use CHAIN_RPC_URL (opBNB testnet) and
                        CHAIN_ID to match your selected opBNB network (204 mainnet / 5611 testnet).
                      </p>
                    ) : (
                      <>
                        <p>
                          Could not load <span className="font-mono text-amber-100/90">GET {baseURL}/api/chain/status</span>
                          {chainStatusError ? ` — ${chainStatusError}` : ""}.
                        </p>
                        <p>
                          Fix: run the API (<span className="font-mono">npm run dev:api</span> from repo root), set{" "}
                          <span className="font-mono">apps/web/.env</span> →{" "}
                          <span className="font-mono">VITE_API_URL=http://localhost:4000</span>, restart Vite (
                          <span className="font-mono">npm run dev:web</span>). In{" "}
                          <span className="font-mono">apps/api/.env</span>, set{" "}
                          <span className="font-mono">CORS_ORIGIN</span> to the exact origin you open in the browser ({" "}
                          <span className="font-mono">http://localhost:5173</span> vs{" "}
                          <span className="font-mono">http://127.0.0.1:5173</span> must match).
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : effectiveCurrentTier ? (
            <p className="text-center text-sm text-[#8b9bb4]">You are on the highest published tier.</p>
          ) : null}
        </div>
      )}

      <div className="mt-6">
        <p className="label-caps mb-3">Related</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <motion.button
            type="button"
            className="btn-neon-ghost flex items-center gap-3 px-4 py-3.5 text-left"
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/income")}
          >
            <span className="icon-pill flex h-10 w-10 shrink-0 items-center justify-center text-white">
              <IconIncomeNav />
            </span>
            <span>
              <span className="block text-[15px] font-semibold text-white">Income</span>
              <span className="text-xs text-[#8b9bb4]">Track earnings and rewards</span>
            </span>
          </motion.button>
          <motion.button
            type="button"
            className="btn-neon-ghost flex items-center gap-3 px-4 py-3.5 text-left"
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/team")}
          >
            <span className="icon-pill flex h-10 w-10 shrink-0 items-center justify-center text-white">
              <IconTeamsNav />
            </span>
            <span>
              <span className="block text-[15px] font-semibold text-white">Teams</span>
              <span className="text-xs text-[#8b9bb4]">Manage referrals &amp; volume</span>
            </span>
          </motion.button>
        </div>
      </div>
    </MobileShell>
  );
}
