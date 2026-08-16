import axios from "axios";
import { authService } from "../services/authService";
import { personalSign, requestWalletAddress } from "./wallet";

/** Wallet sign-in, or link wallet when logged in view-only and address is new (404 on login). */
export async function signAndUpgradeWalletSession(
  setSession: (access: string, refresh: string) => void,
  options: { allowLink: boolean }
): Promise<void> {
  const address = await requestWalletAddress();
  const { message } = await authService.getWalletNonce(address);
  const signature = await personalSign(address, message);
  try {
    const tokens = await authService.loginWithWallet({ walletAddress: address, message, signature });
    setSession(tokens.accessToken, tokens.refreshToken);
  } catch (err) {
    if (options.allowLink && axios.isAxiosError(err) && err.response?.status === 404) {
      const tokens = await authService.linkWallet({ walletAddress: address, message, signature });
      setSession(tokens.accessToken, tokens.refreshToken);
      return;
    }
    throw err;
  }
}
