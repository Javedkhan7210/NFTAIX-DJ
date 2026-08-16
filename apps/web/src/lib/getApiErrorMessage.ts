import axios from "axios";

function messageFromUnknown(err: unknown): string | null {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  if (typeof err === "string" && err.trim()) return err;
  return null;
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    if (!err.response && (err.code === "ERR_NETWORK" || err.message === "Network Error")) {
      return "Network failed. Is the API running at VITE_API_URL?";
    }
    const data = err.response?.data;
    if (data && typeof data === "object" && "message" in data && typeof (data as { message: unknown }).message === "string") {
      const apiMsg = (data as { message: string }).message.trim();
      if (apiMsg) return apiMsg;
    }
    const status = err.response?.status;
    if (status === 404) {
      return "No account for this wallet. Create an account first.";
    }
    return err.message || fallback;
  }

  // MetaMask / injected wallets often throw plain objects: { code: 4001, message: "..." }
  const providerMsg = messageFromUnknown(err);
  if (providerMsg) {
    if (/4001|user rejected|rejected the request/i.test(providerMsg)) {
      return "Signature rejected in wallet.";
    }
    return providerMsg;
  }
  return fallback;
}
