import { getApiErrorMessage } from "./getApiErrorMessage";

const ACTIONABLE =
  /Insufficient USDT|Signature rejected|user rejected|4001|Rejected in wallet|Connect your wallet|Wallet not available|MetaMask|Trust Wallet|own listing|cannot buy your own|register and activate|Activate a package|not registered|not activated|Daily trading limit|dailylimit|Marketplace is paused|Network failed|Network Error|API running|permanently inactive|No account for this wallet|sign in instead|USDT approve|NFT buy failed|buy would revert|would revert|Wrong network|switch.*network|opbnb|No held NFT|Expected.*Connected|same account|Validation failed|Unauthorized|Forbidden|package|BNB for gas|Internal JSON-RPC|chain\/wallet did not return/i;

function cleanMessage(raw: string): string {
  let msg = raw.trim();
  if (/^buy would revert:\s*/i.test(msg)) {
    msg = msg.replace(/^buy would revert:\s*/i, "");
  }
  if (/^Registration would fail:\s*/i.test(msg)) {
    msg = msg.replace(/^Registration would fail:\s*/i, "");
  }
  return msg.length > 240 ? `${msg.slice(0, 237)}…` : msg;
}

function looksTechnical(msg: string): boolean {
  if (msg.length > 280) return true;
  if (/\b0x[a-fA-F0-9]{8,}\b/.test(msg)) return true;
  if (/axios|ECONNREFUSED|ENOTFOUND|stack trace|at Object\./i.test(msg)) return true;
  if (/^\s*\{/.test(msg)) return true;
  return false;
}

/** User app: show actionable wallet/chain/API messages; hide raw technical noise. */
export function getUserFacingError(err: unknown, fallback = "Something went wrong. Try again or refresh the page."): string {
  const raw = getApiErrorMessage(err, "").trim();
  if (!raw) return fallback;

  if (ACTIONABLE.test(raw)) {
    return cleanMessage(raw);
  }

  if (!looksTechnical(raw) && raw.length <= 200) {
    return cleanMessage(raw);
  }

  return fallback;
}
