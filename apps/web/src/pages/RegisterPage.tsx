import axios from "axios";
import type { Address } from "viem";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthScreenShell, authInputClassName } from "../components/AuthScreenShell";
import { useAuth } from "../context/AuthContext";
import { getApiErrorMessage } from "../lib/getApiErrorMessage";
import { assertWalletReadyForRegistration } from "../lib/registrationWalletFunds";
import { ensureValidRegistrationSponsor } from "../lib/registrationReferrer";
import { approveAndPayRegistration } from "../lib/onChainRegistration";
import { checkRegistrationActivateGate } from "../lib/registrationPreflight";
import {
  peekWalletAddress,
  personalSign,
  requestWalletAddress,
  setPreferredWallet
} from "../lib/wallet";
import { authService, type RegistrationContextDto } from "../services/authService";
import { packageService } from "../services/packageService";

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledRef = useRef(false);
  const { setSession, isAuthenticated } = useAuth();

  const [sponsorReferralCode, setSponsorReferralCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [ctx, setCtx] = useState<RegistrationContextDto | null>(null);
  const [onChainActivated, setOnChainActivated] = useState<boolean | null>(null);

  const refFromUrl = searchParams.get("ref") ?? searchParams.get("sponsor") ?? "";
  const loginHref = refFromUrl ? `/login?ref=${encodeURIComponent(refFromUrl)}` : "/login";

  useEffect(() => {
    if (prefilledRef.current) return;
    const r = searchParams.get("ref") ?? searchParams.get("sponsor");
    if (r) {
      setSponsorReferralCode(r);
      prefilledRef.current = true;
    }
  }, [searchParams]);

  useEffect(() => {
    setPreferredWallet("metamask");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void authService
      .getRegistrationContext(undefined)
      .then((c) => {
        if (!cancelled) setCtx(c);
      })
      .catch(() => {
        /* ignore prefetch errors */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!ctx?.registrationHub || !ctx.onChainRegistrationRequired) {
        if (!cancelled) setOnChainActivated(null);
        return;
      }
      try {
        const addr = await peekWalletAddress();
        if (!addr) {
          if (!cancelled) setOnChainActivated(false);
          return;
        }
        const gate = await checkRegistrationActivateGate(
          ctx.registrationHub as Address,
          addr as Address,
          ctx.chainId
        );
        const activated = gate.ok && gate.currentPackageId >= 1;
        if (!cancelled) setOnChainActivated(activated);
      } catch {
        if (!cancelled) setOnChainActivated(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  async function onWalletRegister() {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      // MetaMask must open on the click — connect before any API calls.
      setStatus("Connect wallet — approve the MetaMask popup…");
      const address = await requestWalletAddress();

      setStatus("Loading registration…");
      const regCtx = await authService.getRegistrationContext(sponsorReferralCode.trim() || undefined);
      setCtx(regCtx);

      let registrationTxHash: string | undefined;
      if (regCtx.onChainRegistrationRequired) {
        if (!regCtx.registrationHub || !regCtx.usdt) {
          setError("Server is missing registration contract or USDT address.");
          return;
        }
        setStatus(`Checking ${address.slice(0, 6)}…${address.slice(-4)} on opBNB…`);
        const funds = await assertWalletReadyForRegistration({
          chainId: regCtx.chainId,
          address,
          usdt: regCtx.usdt as Address,
          onGasSponsor: () => setStatus("Low gas — admin paying tBNB for you…")
        });
        setStatus(
          funds.gasSponsored
            ? `Admin sent gas. Ready: ${Number(funds.usdt).toFixed(0)} USDT, ${Number(funds.tbnb).toFixed(4)} tBNB. Confirm in MetaMask…`
            : `Ready: ${Number(funds.usdt).toFixed(0)} USDT, ${Number(funds.tbnb).toFixed(4)} tBNB. Confirm in MetaMask…`
        );
        const rawRef = regCtx.onChainReferrerWallet ?? regCtx.defaultReferrerWallet;
        const preferred =
          rawRef && /^0x[a-fA-F0-9]{40}$/.test(rawRef) ? (rawRef as Address) : null;
        if (!preferred) {
          setError("Registration context missing on-chain sponsor. Refresh and try again.");
          return;
        }
        const sponsorField = sponsorReferralCode.trim();
        const sponsorAsAddr =
          /^0x[a-fA-F0-9]{40}$/.test(sponsorField) ? (sponsorField as Address) : null;
        const referrer = await ensureValidRegistrationSponsor(
          regCtx.registrationHub as Address,
          preferred,
          regCtx.chainId,
          sponsorAsAddr ? [sponsorAsAddr] : []
        );

        registrationTxHash = await approveAndPayRegistration({
          registration: regCtx.registrationHub as Address,
          usdt: regCtx.usdt as Address,
          referrer,
          chainId: regCtx.chainId
        });
      }

      if (isAuthenticated) {
        setStatus("Syncing package…");
        await packageService.syncOnChainActivation();
        setStatus(null);
        navigate("/market?tab=nft", { replace: true });
        return;
      }

      setStatus("Sign login message…");
      const { message } = await authService.getWalletNonce(address);
      const signature = await personalSign(address, message);

      setStatus("Creating account…");
      const tokens = await authService.registerWithWallet({
        walletAddress: address,
        message,
        signature,
        sponsorReferralCode: sponsorReferralCode.trim() || undefined,
        registrationTxHash
      });
      setSession(tokens.accessToken, tokens.refreshToken);
      setStatus(null);
      navigate("/home", { replace: true });
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && !err.response && (err.code === "ERR_NETWORK" || err.message === "Network Error")) {
        setError("Network failed. Is the API running?");
      } else {
        setError(getApiErrorMessage(err, "Registration failed. Try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreenShell
      eyebrow="Join"
      title="Create account"
      footer={
        <p className="text-center text-sm text-[var(--text-sub)]">
          Already registered?{" "}
          <Link
            to={loginHref}
            className="font-semibold text-[#00d1ff] transition-colors hover:text-[#8a2eff] hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      {!isAuthenticated && onChainActivated === true ? (
        <div className="mb-5 rounded-[18px] border border-[#22E6A0]/35 bg-[#22E6A0]/10 px-4 py-3 text-sm leading-snug text-[#c5f5dc]">
          This MetaMask wallet is <span className="font-semibold text-white">already registered &amp; activated</span> on
          the current contract.{" "}
          <Link to={loginHref} className="font-semibold text-[#00d1ff] underline">
            Sign in
          </Link>{" "}
          instead — or switch MetaMask to a different wallet to create a new account.
        </div>
      ) : isAuthenticated && onChainActivated === false ? (
        <div className="mb-5 rounded-[18px] border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm leading-snug text-amber-100">
          You are signed in, but this wallet is <span className="font-semibold text-white">not activated on the current
          Registration contract</span> (needed for NFT buy). Pay the $5 package below with the same MetaMask wallet.
        </div>
      ) : isAuthenticated && onChainActivated ? (
        <div className="mb-5 rounded-[18px] border border-[#22E6A0]/35 bg-[#22E6A0]/10 px-4 py-3 text-sm leading-snug text-[#c5f5dc]">
          This wallet is already activated on-chain.{" "}
          <Link to="/market?tab=nft" className="font-semibold text-[#00d1ff] underline">
            Go to NFT market
          </Link>
        </div>
      ) : isAuthenticated ? (
        <div className="mb-5 rounded-[18px] border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm leading-snug text-amber-100">
          Connect MetaMask to check on-chain activation status, or register below with the same wallet you use to sign in.
        </div>
      ) : null}

      <div className="mb-5">
        <label className="label-caps">Sponsor (optional)</label>
        <input
          className={authInputClassName}
          value={sponsorReferralCode}
          onChange={(e) => setSponsorReferralCode(e.target.value)}
          placeholder="Leave empty (recommended)"
        />
      </div>

      {status ? (
        <p className="mb-4 text-center text-sm text-[#00d1ff]/90" aria-live="polite">
          {status}
        </p>
      ) : null}

      {error ? (
        <div
          className="mb-5 rounded-[18px] border border-red-400/35 bg-red-950/40 px-4 py-3 text-sm leading-snug text-red-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || onChainActivated === true}
        onClick={() => void onWalletRegister()}
        className="btn-neon-ghost w-full py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy
          ? status || "Waiting for wallet…"
          : onChainActivated === true
            ? isAuthenticated
              ? "Already activated"
              : "Wallet already registered"
            : isAuthenticated
              ? "Activate on current contract ($5)"
              : "Register with wallet"}
      </button>

      {onChainActivated === true && !isAuthenticated ? (
        <Link
          to={loginHref}
          className="btn-neon-fill mt-3 block w-full py-3.5 text-center text-sm font-semibold"
        >
          Sign in with this wallet
        </Link>
      ) : null}
    </AuthScreenShell>
  );
}
