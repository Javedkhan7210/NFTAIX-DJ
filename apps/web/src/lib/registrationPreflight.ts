import type { Address } from "viem";
import { ENTRY_PACKAGE_ID, PACKAGE_USD, registrationAbi } from "./abis/registrationAbi";
import { createConfiguredPublicClient, createPublicClientForChainId } from "./opbnb";
import { getInjectedProvider } from "./wallet";

/** Package USD amounts (index 0 = package id 1). */
export { PACKAGE_USD };

export type RegistrationActivateGate =
  | {
      ok: true;
      requiredPackageId: number;
      currentPackageId: number;
      /** @deprecated alias of requiredPackageId */
      requiredLevel: number;
      /** @deprecated alias of currentPackageId */
      currentOnChainLevel: number;
    }
  | { ok: false; message: string };

export async function getConnectedWalletAddress(): Promise<Address | null> {
  try {
    const eth = getInjectedProvider();
    const first = await eth.request({ method: "eth_accounts" });
    if (!Array.isArray(first) || !first[0]) {
      await eth.request({ method: "eth_requestAccounts" });
    }
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    const a = accounts?.[0];
    return typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a) ? (a as Address) : null;
  } catch {
    return null;
  }
}

/**
 * Gate for first activation (package 1) or next upgrade package id.
 */
export async function checkRegistrationActivateGate(
  registration: Address,
  wallet: Address,
  apiChainId?: number
): Promise<RegistrationActivateGate> {
  const client =
    apiChainId != null && Number.isFinite(apiChainId)
      ? createPublicClientForChainId(apiChainId)
      : createConfiguredPublicClient();

  const user = await client.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "users",
    args: [wallet]
  });

  const registered = user[0];
  const activated = user[1];
  const packageId = Number(user[4]);

  if (!registered || !activated) {
    return {
      ok: true,
      requiredPackageId: ENTRY_PACKAGE_ID,
      currentPackageId: 0,
      requiredLevel: ENTRY_PACKAGE_ID,
      currentOnChainLevel: 0
    };
  }

  const maxId = PACKAGE_USD.length;
  if (packageId >= maxId) {
    return {
      ok: false,
      message: `This wallet is already on package ${packageId} (max ${maxId}). Use Sign in.`
    };
  }

  const next = packageId + 1;
  return {
    ok: true,
    requiredPackageId: next,
    currentPackageId: packageId,
    requiredLevel: next,
    currentOnChainLevel: packageId
  };
}
