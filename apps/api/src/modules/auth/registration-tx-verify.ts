import { decodeFunctionData } from "viem";
import { env } from "../../shared/config/env.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { ENTRY_PACKAGE_ID, registrationAbi } from "../chain/registration-abi.js";

function lc(a: string): string {
  return a.toLowerCase();
}

function registrationAddress(): `0x${string}` | undefined {
  const a = env.REGISTRATION_CONTRACT_ADDRESS;
  return a as `0x${string}` | undefined;
}

/**
 * Verifies successful Registration `activate(1)` for wallet signup.
 * After the tx, on-chain `users(user).sponsor` must match `expectedOnChainReferrer`.
 */
export async function verifyPaidRegistrationTx(params: {
  txHash: `0x${string}`;
  expectedUser: `0x${string}`;
  expectedOnChainReferrer: `0x${string}`;
}): Promise<void> {
  const registration = registrationAddress();
  if (!registration) {
    throw Object.assign(new Error("REGISTRATION_CONTRACT_ADDRESS is not configured"), { status: 500 });
  }

  const client = getPublicClient();
  const receipt = await client.getTransactionReceipt({ hash: params.txHash });
  if (!receipt || receipt.status !== "success") {
    throw Object.assign(new Error("Registration transaction failed or was not found on this chain."), {
      status: 400
    });
  }

  const tx = await client.getTransaction({ hash: params.txHash });
  if (!tx) {
    throw Object.assign(new Error("Transaction not found."), { status: 400 });
  }

  if (lc(tx.from) !== lc(params.expectedUser)) {
    throw Object.assign(new Error("Transaction sender does not match the wallet being registered."), {
      status: 400
    });
  }

  if (!tx.to || lc(tx.to) !== lc(registration)) {
    throw Object.assign(new Error("Transaction is not a call to the Registration contract."), {
      status: 400
    });
  }

  let packageId: number;
  try {
    const decoded = decodeFunctionData({ abi: registrationAbi, data: tx.input });
    if (decoded.functionName === "activate") {
      packageId = Number(decoded.args[0]);
    } else if (decoded.functionName === "registerAndActivate") {
      packageId = Number(decoded.args[1]);
    } else {
      throw new Error("not activate");
    }
  } catch {
    throw Object.assign(
      new Error(
        "Could not decode registration transaction. Sign up requires registerAndActivate(sponsor, 1) or activate(1)."
      ),
      { status: 400 }
    );
  }

  if (packageId !== ENTRY_PACKAGE_ID) {
    throw Object.assign(
      new Error("On-chain registration must use package id 1 ($5 entry). Use Upgrade for higher packages."),
      { status: 400 }
    );
  }

  const user = await client.readContract({
    address: registration,
    abi: registrationAbi,
    functionName: "users",
    args: [params.expectedUser]
  });

  const registered = user[0];
  const activated = user[1];
  const sponsor = user[3] as `0x${string}`;

  if (!registered || !activated) {
    throw Object.assign(
      new Error("Wallet is not registered+activated on-chain after this transaction."),
      { status: 400 }
    );
  }

  if (lc(sponsor) !== lc(params.expectedOnChainReferrer)) {
    throw Object.assign(
      new Error(
        "On-chain sponsor does not match the required referrer for this signup. Re-register with the correct sponsor wallet."
      ),
      { status: 400 }
    );
  }
}
