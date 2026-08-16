import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { api, AUTH_EVENT, clearTokens, setTokens } from "../api/client";
import { clearHeaderStatsCache } from "../components/HeaderStatsBar";
import { decodeJwtPayload, hasFullWalletAccessFromPayload } from "../lib/jwt";
import { clearBoundWalletProvider, disconnectWallet } from "../lib/wallet";
import { authService } from "../services/authService";

const ROLE = "role";
const SESSION_START = "sessionStartMs";
const LAST_ACTIVITY = "lastActivityMs";

const MAX_SESSION_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_IDLE_MS = 15 * 60 * 1000; // 15 minutes (configurable later if needed)

function nowMs() {
  return Date.now();
}

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, n: number) {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
}

type AuthContextValue = {
  accessToken: string | null;
  isAuthenticated: boolean;
  hasFullAccess: boolean;
  isViewOnlySession: boolean;
  setSession: (accessToken: string, refreshToken: string) => void;
  clearSession: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function syncApiAuth(token: string | null) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

async function clearClientCacheStorage() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.clear();
  } catch {
    /* ignore storage clear errors */
  }
  try {
    // Full logout should wipe client-side session & cached state.
    localStorage.clear();
  } catch {
    /* ignore storage clear errors */
  }
  if (!("caches" in window)) return;
  try {
    const keys = await window.caches.keys();
    await Promise.all(keys.map((k) => window.caches.delete(k)));
  } catch {
    /* ignore cache API errors */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() => localStorage.getItem("accessToken"));

  useEffect(() => {
    syncApiAuth(accessToken);
  }, [accessToken]);

  const setSession = useCallback((access: string, refresh: string) => {
    flushSync(() => {
      setTokens(access, refresh);
      setAccessToken(access);
      syncApiAuth(access);
      const payload = decodeJwtPayload(access);
      if (payload?.role) localStorage.setItem(ROLE, payload.role);

      const started = readNumber(SESSION_START);
      const iatMs = typeof payload?.iat === "number" ? payload.iat * 1000 : null;
      writeNumber(SESSION_START, started ?? iatMs ?? nowMs());
      writeNumber(LAST_ACTIVITY, nowMs());
    });
  }, []);

  const clearSession = useCallback(() => {
    clearTokens();
    setAccessToken(null);
    syncApiAuth(null);
    clearBoundWalletProvider();
    try {
      localStorage.removeItem(SESSION_START);
      localStorage.removeItem(LAST_ACTIVITY);
    } catch {
      /* ignore */
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      /* still clear locally */
    } finally {
      clearHeaderStatsCache();
      await disconnectWallet();
      await clearClientCacheStorage();
      clearSession();
    }
  }, [clearSession]);

  // Keep AuthContext in sync when tokens are cleared/set outside this provider (e.g. axios interceptor).
  useEffect(() => {
    const onAuthChange = () => {
      const next = localStorage.getItem("accessToken");
      setAccessToken(next);
      syncApiAuth(next);
    };
    window.addEventListener(AUTH_EVENT, onAuthChange);
    window.addEventListener("storage", onAuthChange);
    return () => {
      window.removeEventListener(AUTH_EVENT, onAuthChange);
      window.removeEventListener("storage", onAuthChange);
    };
  }, []);

  // Auto logout: tab close, inactivity, absolute max session (1 hour).
  useEffect(() => {
    if (!accessToken) return;

    const payload = decodeJwtPayload(accessToken);
    const started = readNumber(SESSION_START);
    const iatMs = typeof payload?.iat === "number" ? payload.iat * 1000 : null;
    const sessionStart = started ?? iatMs ?? nowMs();
    writeNumber(SESSION_START, sessionStart);

    const touch = () => writeNumber(LAST_ACTIVITY, nowMs());
    const activityEvents: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    for (const ev of activityEvents) window.addEventListener(ev, touch, { passive: true });

    const onPageHide = (e: PageTransitionEvent) => {
      // Tab close / full navigation: revoke refresh server-side only. Do not clear local tokens here —
      // that logged users out after in-app flows that triggered pagehide (e.g. post-purchase reload).
      if (!e.persisted) authService.logoutKeepalive(accessToken);
    };
    window.addEventListener("pagehide", onPageHide);

    const timer = window.setInterval(() => {
      const t = nowMs();
      const ss = readNumber(SESSION_START) ?? sessionStart;
      const la = readNumber(LAST_ACTIVITY) ?? t;

      if (t - ss >= MAX_SESSION_MS) {
        void logout();
        return;
      }
      if (t - la >= DEFAULT_IDLE_MS) {
        void logout();
      }
    }, 10_000);

    return () => {
      window.clearInterval(timer);
      for (const ev of activityEvents) window.removeEventListener(ev, touch as any);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [accessToken, clearSession, logout]);

  const sessionInfo = useMemo(() => {
    const payload = accessToken ? decodeJwtPayload(accessToken) : null;
    const hasFullAccess = hasFullWalletAccessFromPayload(payload);
    return {
      hasFullAccess,
      isViewOnlySession: !!accessToken && !hasFullAccess
    };
  }, [accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      isAuthenticated: !!accessToken,
      hasFullAccess: sessionInfo.hasFullAccess,
      isViewOnlySession: sessionInfo.isViewOnlySession,
      setSession,
      clearSession,
      logout
    }),
    [accessToken, sessionInfo.hasFullAccess, sessionInfo.isViewOnlySession, setSession, clearSession, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
