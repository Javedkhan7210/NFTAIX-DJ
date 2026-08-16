export type JwtAccessPayload = {
  sub: string;
  role: "user" | "admin" | "superadmin";
  walletSession?: boolean;
  /** Issued-at timestamp (seconds since epoch). */
  iat?: number;
  exp?: number;
};

export function decodeJwtPayload<T extends object = JwtAccessPayload>(token: string): T | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Mirrors API: non-user roles always have full access; legacy tokens omit walletSession and count as full access for users. */
export function hasFullWalletAccessFromPayload(payload: JwtAccessPayload | null): boolean {
  if (!payload) return false;
  if (payload.role !== "user") return true;
  return payload.walletSession !== false;
}
