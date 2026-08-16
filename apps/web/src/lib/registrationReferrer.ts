import { type Address, zeroAddress } from "viem";
import { registrationAbi } from "./abis/registrationAbi";
import { createConfiguredPublicClient, createPublicClientForChainId } from "./opbnb";

function lc0x(a: string): string {
  return a.trim().toLowerCase();
}

function dedupeAddresses(addrs: Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of addrs) {
    const k = lc0x(a);
    if (!k || k === lc0x(zeroAddress)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * Registration `register(sponsor)` requires `users(sponsor).registered == true`.
 */
export async function ensureValidRegistrationSponsor(
  registration: Address,
  preferred: Address,
  apiChainId: number | undefined,
  extraCandidates: Address[] = []
): Promise<Address> {
  const client =
    apiChainId != null && Number.isFinite(apiChainId)
      ? createPublicClientForChainId(apiChainId)
      : createConfiguredPublicClient();

  const isRegistered = async (a: Address) => {
    const u = await client.readContract({
      address: registration,
      abi: registrationAbi,
      functionName: "users",
      args: [a]
    });
    return Boolean(u[0]);
  };

  for (const cand of dedupeAddresses([preferred, ...extraCandidates])) {
    if (await isRegistered(cand)) return cand;
  }

  try {
    const root = (await client.readContract({
      address: registration,
      abi: registrationAbi,
      functionName: "rootSponsor"
    })) as Address;
    if (await isRegistered(root)) return root;
  } catch {
    /* ignore */
  }

  try {
    const own = (await client.readContract({
      address: registration,
      abi: registrationAbi,
      functionName: "owner"
    })) as Address;
    if (await isRegistered(own)) return own;
  } catch {
    /* ignore */
  }

  throw new Error(
    `No valid Registration sponsor on chain ${apiChainId ?? "unknown"} for ${registration} ` +
      `(tried preferred, rootSponsor, owner). Deploy Registration with a rootSponsor, or set REGISTRATION_REFERRER_FALLBACK.`
  );
}
