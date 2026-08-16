type Eip6963ProviderDetail = {
  info: { rdns: string; name: string; uuid: string };
  provider: EthProvider;
};

const discoveredProviders: Eip6963ProviderDetail[] = [];

function initEip6963Discovery() {
  if (typeof window === "undefined") return;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (!detail?.provider) return;
    if (discoveredProviders.some((d) => d.info.uuid === detail.info.uuid)) return;
    discoveredProviders.push(detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

initEip6963Discovery();

/** Re-announce EIP-6963 wallets (call on user click before connect). */
export function refreshWalletProviders(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
}

function findMetaMaskFromEip6963(): EthProvider | undefined {
  return discoveredProviders.find((d) => d.info.rdns === "io.metamask")?.provider;
}

function findTrustFromEip6963(): EthProvider | undefined {
  return discoveredProviders.find((d) => d.info.rdns === "com.trustwallet.app")?.provider;
}

type EthProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  providers?: EthProvider[];
  selectedAddress?: string | null;
};

declare global {
  interface Window {
    ethereum?: EthProvider;
    trustwallet?: EthProvider;
  }
}

export type WalletKind = "metamask" | "trust" | "auto";

const WALLET_RDNS_KEY = "nftaix_wallet_rdns";
export const WALLET_DISCONNECT_EVENT = "nftaix:wallet-disconnect";

let preferredWallet: WalletKind = "metamask";
let boundProvider: EthProvider | null = null;

export function setPreferredWallet(kind: WalletKind) {
  preferredWallet = kind;
}

function rdnsForProvider(p: EthProvider): string | null {
  const hit = discoveredProviders.find((d) => d.provider === p);
  if (hit) return hit.info.rdns;
  if (isTrustProvider(p)) return "com.trustwallet.app";
  if (p.isMetaMask) return "io.metamask";
  return null;
}

function resolveProviderByRdns(rdns: string): EthProvider | undefined {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const trustGlobal = typeof window !== "undefined" ? window.trustwallet : undefined;

  if (rdns === "io.metamask") {
    return (
      findMetaMaskFromEip6963() ??
      eth?.providers?.find((p) => p.isMetaMask && !isTrustProvider(p)) ??
      (eth?.isMetaMask && !isTrustProvider(eth) ? eth : undefined)
    );
  }
  if (rdns === "com.trustwallet.app") {
    return (
      findTrustFromEip6963() ??
      trustGlobal ??
      eth?.providers?.find(isTrustProvider) ??
      (eth && isTrustProvider(eth) ? eth : undefined)
    );
  }
  return undefined;
}

/** Pin the wallet extension used at login for all later on-chain txs. */
export function bindWalletProvider(provider: EthProvider): void {
  boundProvider = provider;
  const rdns = rdnsForProvider(provider);
  if (rdns === "io.metamask") preferredWallet = "metamask";
  else if (rdns === "com.trustwallet.app") preferredWallet = "trust";
  try {
    if (rdns) localStorage.setItem(WALLET_RDNS_KEY, rdns);
  } catch {
    /* ignore storage */
  }
}

export function clearBoundWalletProvider(): void {
  boundProvider = null;
  preferredWallet = "metamask";
  try {
    localStorage.removeItem(WALLET_RDNS_KEY);
  } catch {
    /* ignore storage */
  }
}

/** Logout: unbind app wallet session and revoke dApp account permission when supported. */
export async function disconnectWallet(): Promise<void> {
  const provider = boundProvider;
  clearBoundWalletProvider();
  if (provider) {
    try {
      await provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }]
      });
    } catch {
      /* MetaMask / Trust may not support revoke — binding clear is enough for app session */
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WALLET_DISCONNECT_EVENT));
  }
}

function restoreBoundProviderFromStorage(): void {
  if (typeof window === "undefined" || boundProvider) return;
  try {
    const rdns = localStorage.getItem(WALLET_RDNS_KEY);
    if (!rdns) return;
    const p = resolveProviderByRdns(rdns);
    if (p) {
      boundProvider = p;
      if (rdns === "io.metamask") preferredWallet = "metamask";
      else if (rdns === "com.trustwallet.app") preferredWallet = "trust";
    }
  } catch {
    /* ignore storage */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", () => {
    restoreBoundProviderFromStorage();
  });
  setTimeout(() => restoreBoundProviderFromStorage(), 300);
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function isTrustProvider(p: EthProvider): boolean {
  return Boolean(p.isTrust || p.isTrustWallet);
}

function providerErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  if (err instanceof Error) return err.message;
  return String(err ?? "Wallet error");
}

function providerErrorCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const n = Number((err as { code: unknown }).code);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Use the wallet bound at login, else pick MetaMask/Trust by preference. */
export function getInjectedProvider(): EthProvider {
  restoreBoundProviderFromStorage();
  if (boundProvider) return boundProvider;

  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const trustGlobal = typeof window !== "undefined" ? window.trustwallet : undefined;

  if (preferredWallet === "trust") {
    if (trustGlobal) return trustGlobal;
    const t6963 = findTrustFromEip6963();
    if (t6963) return t6963;
    const t = eth?.providers?.find(isTrustProvider);
    if (t) return t;
    if (eth && isTrustProvider(eth)) return eth;
    throw new Error("Trust Wallet not found. Install it or switch to MetaMask.");
  }

  if (preferredWallet === "metamask" || preferredWallet === "auto") {
    const mm6963 = findMetaMaskFromEip6963();
    if (mm6963) return mm6963;
    const mm = eth?.providers?.find((p) => p.isMetaMask && !isTrustProvider(p));
    if (mm) return mm;
    if (eth?.isMetaMask && !isTrustProvider(eth)) return eth;
  }

  if (!eth && trustGlobal) return trustGlobal;
  if (!eth) {
    throw new Error("Wallet not found. Install MetaMask, then refresh.");
  }

  if (eth.providers?.length) {
    const mm = eth.providers.find((p) => p.isMetaMask && !isTrustProvider(p));
    if (mm) return mm;
    const trust = eth.providers.find(isTrustProvider);
    if (trust) return trust;
    return eth.providers[0]!;
  }
  return eth;
}

export function isWalletProviderAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.ethereum ||
      window.trustwallet ||
      findMetaMaskFromEip6963() ||
      findTrustFromEip6963() ||
      discoveredProviders.length
  );
}

export function detectInstalledWallets(): { metamask: boolean; trust: boolean } {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const many = eth?.providers;
  return {
    metamask: Boolean(
      (eth?.isMetaMask && !isTrustProvider(eth)) ||
        many?.some((p) => p.isMetaMask && !isTrustProvider(p))
    ),
    trust: Boolean(window.trustwallet || eth?.isTrust || eth?.isTrustWallet || many?.some(isTrustProvider))
  };
}

export async function peekWalletAddress(): Promise<string | null> {
  try {
    const eth = getInjectedProvider();
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    const addr = accounts[0]?.trim()?.toLowerCase();
    return addr && isHexAddress(addr) ? addr : null;
  } catch {
    return null;
  }
}

export async function requestWalletAddress(): Promise<string> {
  refreshWalletProviders();
  let eth: EthProvider;
  try {
    eth = getInjectedProvider();
  } catch {
    throw new Error(
      "MetaMask not found. Use Chrome with the MetaMask extension, unlock it, refresh this page, then try again."
    );
  }
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const addr = accounts?.[0]?.trim()?.toLowerCase();
    if (!addr || !isHexAddress(addr)) {
      throw new Error("No account returned. Unlock MetaMask and click Connect.");
    }
    bindWalletProvider(eth);
    return addr;
  } catch (err: unknown) {
    throw mapWalletProviderError(err);
  }
}

function toUtf8Hex(message: string): `0x${string}` {
  const bytes = new TextEncoder().encode(message);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

export async function personalSign(address: string, message: string): Promise<string> {
  const eth = getInjectedProvider();
  bindWalletProvider(eth);
  const expected = address.trim().toLowerCase();
  if (!isHexAddress(expected)) throw new Error("Invalid wallet address for signing.");

  let live: string;
  try {
    const existing = (await eth.request({ method: "eth_accounts" })) as string[];
    const fromExisting = existing?.[0]?.trim()?.toLowerCase();
    live = fromExisting && isHexAddress(fromExisting) ? fromExisting : await requestWalletAddress();
  } catch {
    live = await requestWalletAddress();
  }

  if (live !== expected) {
    throw new Error(`Connected ${live}, but expected ${expected}. Use the same account.`);
  }

  const attempts: unknown[][] = [
    [message, live],
    [toUtf8Hex(message), live],
    [live, message],
    [live, toUtf8Hex(message)]
  ];

  let lastErr: unknown;
  for (const params of attempts) {
    try {
      const sig = (await eth.request({ method: "personal_sign", params })) as string;
      if (typeof sig === "string" && sig.startsWith("0x") && sig.length >= 132) return sig;
      lastErr = new Error("Empty signature");
    } catch (err) {
      lastErr = err;
      if (providerErrorCode(err) === 4001) throw new Error("Signature rejected in wallet.");
    }
  }
  throw mapWalletProviderError(lastErr);
}

function mapWalletProviderError(err: unknown): Error {
  const raw = providerErrorMessage(err);
  const code = providerErrorCode(err);
  if (code === 4001 || /user rejected|rejected the request/i.test(raw)) {
    return new Error("Rejected in wallet. Click Connect / Confirm.");
  }
  if (/unable to find any account for 60\b/i.test(raw) || /account for 60\b/i.test(raw)) {
    return new Error(
      "Trust Wallet has no Ethereum account (coin type 60). Disable Trust, use MetaMask only, refresh, retry."
    );
  }
  if (/unable to find any account/i.test(raw)) {
    return new Error(`${raw}. Prefer MetaMask; unlock and select an account.`);
  }
  return new Error(raw || "Wallet failed");
}
