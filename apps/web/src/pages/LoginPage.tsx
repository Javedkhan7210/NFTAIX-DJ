import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthScreenShell, authInputClassName } from "../components/AuthScreenShell";
import { useAuth } from "../context/AuthContext";
import { getApiErrorMessage } from "../lib/getApiErrorMessage";
import { isWalletProviderAvailable, personalSign, requestWalletAddress } from "../lib/wallet";
import { authService } from "../services/authService";

function defaultAfterLogin(): string {
  const v = import.meta.env.VITE_DEFAULT_AFTER_LOGIN;
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/home";
}

/** Internal path only — avoids open redirects. */
function postLoginPath(redirectParam: string | null): string {
  const raw = redirectParam?.trim() ?? "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return defaultAfterLogin();
}

function mainAppOrigin(): string {
  const o = import.meta.env.VITE_MAIN_APP_ORIGIN;
  return typeof o === "string" ? o.replace(/\/$/, "") : "";
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectAfterLogin = searchParams.get("redirect");
  const refFromUrl = searchParams.get("ref") ?? searchParams.get("sponsor") ?? "";
  const origin = mainAppOrigin();
  const registerHref = origin
    ? `${origin}/register${refFromUrl ? `?ref=${encodeURIComponent(refFromUrl)}` : ""}`
    : refFromUrl
      ? `/register?ref=${encodeURIComponent(refFromUrl)}`
      : "/register";
  const { setSession, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    navigate(postLoginPath(redirectAfterLogin), { replace: true });
  }, [isAuthenticated, navigate, redirectAfterLogin]);

  const [identifierInput, setIdentifierInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPublicLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const id = identifierInput.trim();
    if (!id) {
      setError("Enter your user ID or wallet address.");
      return;
    }
    setBusy(true);
    try {
      const tokens = await authService.loginWithPublicIdentifier(id);
      setSession(tokens.accessToken, tokens.refreshToken);
      navigate(postLoginPath(redirectAfterLogin), { replace: true });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Sign in failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onWalletSignIn() {
    setError(null);
    if (!isWalletProviderAvailable()) {
      setError("Wallet not found.");
      return;
    }
    setBusy(true);
    try {
      const address = await requestWalletAddress();
      const { message } = await authService.getWalletNonce(address);
      const signature = await personalSign(address, message);
      const tokens = await authService.loginWithWallet({ walletAddress: address, message, signature });
      setSession(tokens.accessToken, tokens.refreshToken);
      navigate(postLoginPath(redirectAfterLogin), { replace: true });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Wallet sign-in failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreenShell
      eyebrow="Welcome back"
      title="Sign in"
      footer={
        <p className="text-center text-sm text-[var(--text-sub)]">
          New here?{" "}
          {registerHref.startsWith("http") ? (
            <a
              href={registerHref}
              className="font-semibold text-[#00d1ff] transition-colors hover:text-[#8a2eff] hover:underline"
              rel="noreferrer"
            >
              Create an account
            </a>
          ) : (
            <Link
              to={registerHref}
              className="font-semibold text-[#00d1ff] transition-colors hover:text-[#8a2eff] hover:underline"
            >
              Create an account
            </Link>
          )}
        </p>
      }
    >
      {refFromUrl ? (
        <p className="label-caps mb-5 text-center">
          Invite code <span className="font-mono text-[#00d1ff]">{refFromUrl}</span>
        </p>
      ) : null}

      {error ? (
        <div
          className="mb-5 rounded-[18px] border border-red-400/35 bg-red-950/40 px-4 py-3 text-sm leading-snug text-red-100 shadow-[0_0_20px_rgba(239,68,68,0.12)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={onPublicLogin} className="flex flex-col gap-5">
        <div>
          <label className="label-caps">User ID or wallet address</label>
          <input
            className={authInputClassName}
            value={identifierInput}
            onChange={(e) => setIdentifierInput(e.target.value)}
            placeholder="e.g. 1 or 0x…"
            autoComplete="username"
            spellCheck={false}
            required
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="btn-neon-fill mt-1 w-full py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onWalletSignIn()}
          className="btn-neon-ghost w-full py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "Waiting for wallet…" : "Sign in with opBNB wallet"}
        </button>
      </form>
    </AuthScreenShell>
  );
}
