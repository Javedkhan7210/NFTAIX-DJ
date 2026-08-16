import { api } from "../api/client";

export type TokenResponse = { accessToken: string; refreshToken: string; expiresIn: number };

export type RegistrationContextDto = {
  onChainRegistrationRequired: boolean;
  chainId: number;
  usdt: string | null;
  registrationHub: string | null;
  registrationFeeWei: string | null;
  usdtDecimals: number;
  sponsorWallet: string | null;
  /** Registration `rootSponsor()` — fallback display; use `onChainReferrerWallet` for register(). */
  defaultReferrerWallet: string | null;
  /** Resolved sponsor for `register(sponsor)` / activate verify (must match API). */
  onChainReferrerWallet: string | null;
  sponsorNotOnChain?: boolean;
};

export const authService = {
  async loginAdminWithEmail(email: string, password: string) {
    const { data } = await api.post<TokenResponse>("/api/auth/login/admin", { email, password });
    return data;
  },

  async loginWithUserId(publicUserNumber: number) {
    const { data } = await api.post<TokenResponse>("/api/auth/login/user-id", { publicUserNumber });
    return data;
  },

  async loginWithWalletAddress(walletAddress: string) {
    const { data } = await api.post<TokenResponse>("/api/auth/login/wallet-address", { walletAddress });
    return data;
  },

  async loginWithPublicIdentifier(identifier: string) {
    const { data } = await api.post<TokenResponse>("/api/auth/login/public", { identifier });
    return data;
  },

  async getWalletNonce(address: string) {
    const { data } = await api.get<{ message: string; nonce: string; expiresInSec: number }>("/api/auth/wallet/nonce", {
      params: { address }
    });
    return data;
  },

  async getRegistrationContext(sponsorReferralCode?: string) {
    const { data } = await api.get<RegistrationContextDto>("/api/auth/registration-context", {
      params: sponsorReferralCode ? { ref: sponsorReferralCode } : undefined
    });
    return data;
  },

  async registerWithWallet(params: {
    walletAddress: string;
    message: string;
    signature: string;
    sponsorReferralCode?: string;
    registrationTxHash?: string;
  }) {
    const { data } = await api.post<TokenResponse>("/api/auth/register/wallet", params);
    return data;
  },

  async loginWithWallet(params: { walletAddress: string; message: string; signature: string }) {
    const { data } = await api.post<TokenResponse>("/api/auth/login/wallet", params);
    return data;
  },

  async linkWallet(params: { walletAddress: string; message: string; signature: string }) {
    const { data } = await api.post<TokenResponse>("/api/auth/wallet/link", params);
    return data;
  },

  async logout() {
    await api.post("/api/auth/logout");
  },

  /**
   * Best-effort logout suitable for tab close / navigation.
   * Uses fetch keepalive so the request can finish during unload.
   */
  logoutKeepalive(accessToken: string) {
    try {
      const baseURL = api.defaults.baseURL ?? "";
      void fetch(`${baseURL}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: "{}",
        keepalive: true
      });
    } catch {
      /* ignore */
    }
  }
};
