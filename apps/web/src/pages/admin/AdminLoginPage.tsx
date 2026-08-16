import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthScreenShell, authInputClassName } from "../../components/AuthScreenShell";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { authService } from "../../services/authService";

function postLoginPath(redirectParam: string | null): string {
  const raw = redirectParam?.trim() ?? "";
  if (raw.startsWith("/admin") && !raw.startsWith("//")) return raw;
  return "/admin";
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectAfterLogin = searchParams.get("redirect");
  const { setSession, isAuthenticated } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const role = localStorage.getItem("role");
    if (role === "admin" || role === "superadmin") {
      navigate(postLoginPath(redirectAfterLogin), { replace: true });
    }
  }, [isAuthenticated, navigate, redirectAfterLogin]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError("Enter admin email and password.");
      return;
    }
    setBusy(true);
    try {
      const tokens = await authService.loginAdminWithEmail(email.trim(), password);
      setSession(tokens.accessToken, tokens.refreshToken);
      navigate(postLoginPath(redirectAfterLogin), { replace: true });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Admin login failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreenShell eyebrow="Admin panel" title="Admin Sign In">
      {error ? (
        <div
          className="mb-5 rounded-[18px] border border-red-400/35 bg-red-950/40 px-4 py-3 text-sm leading-snug text-red-100 shadow-[0_0_20px_rgba(239,68,68,0.12)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div>
          <label className="label-caps">Admin Email</label>
          <input
            type="email"
            className={authInputClassName}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="label-caps">Password</label>
          <input
            type="password"
            className={authInputClassName}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="btn-neon-fill mt-1 w-full py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "Signing in..." : "Sign in to Admin"}
        </button>
      </form>
    </AuthScreenShell>
  );
}
