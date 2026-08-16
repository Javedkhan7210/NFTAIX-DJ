import { api } from "../api/client";

export type AdminGasSponsorResult = {
  ok: true;
  chainId: number;
  address: string;
  gasTxHash: string | null;
  nativeBalance: string;
  sponsored: boolean;
  message: string;
};

/** TEMPORARY testnet helper — admin wallet drips tBNB when user has no gas. */
export async function requestAdminGasSponsor(address: string): Promise<AdminGasSponsorResult> {
  const { data } = await api.post<AdminGasSponsorResult>("/api/public/admin-gas-sponsor", { address });
  return data;
}
