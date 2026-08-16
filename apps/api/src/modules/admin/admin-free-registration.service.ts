/**
 * Authorizer/admin: free on-chain register+activate / upgrade (no USDT pull).
 */
import {
  createWalletClient,
  getAddress,
  http,
  isAddress,
  publicActions,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../shared/config/env.js";
import { appChain, getPublicClient } from "../chain/chain-viem.js";
import { registrationAbi } from "../chain/registration-abi.js";

function authorizerAccount() {
  const raw =
    env.CONTRACT_ADMIN_PRIVATE_KEY?.trim() ||
    env.MARKETPLACE_OWNER_PRIVATE_KEY?.trim() ||
    env.CHAIN_PRIVATE_KEY?.trim();
  if (!raw) {
    throw Object.assign(new Error("CONTRACT_ADMIN_PRIVATE_KEY / CHAIN_PRIVATE_KEY missing"), {
      status: 500
    });
  }
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return privateKeyToAccount(pk);
}

function registrationAddress(): Address {
  const a = env.REGISTRATION_CONTRACT_ADDRESS?.trim();
  if (!a || !isAddress(a)) {
    throw Object.assign(new Error("REGISTRATION_CONTRACT_ADDRESS not set"), { status: 500 });
  }
  return getAddress(a);
}

function walletClient() {
  const account = authorizerAccount();
  return createWalletClient({
    account,
    chain: appChain,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);
}

export async function adminFreeRegisterAndActivate(params: {
  userWallet: string;
  sponsorWallet: string;
  packageId?: number;
}): Promise<{ txHash: Hex; packageId: number }> {
  const user = getAddress(params.userWallet);
  const sponsor = getAddress(params.sponsorWallet);
  const packageId = Math.max(1, Math.min(11, Number(params.packageId ?? 1) || 1));
  const reg = registrationAddress();
  const client = walletClient();
  const publicClient = getPublicClient();

  const authorizer = await publicClient.readContract({
    address: reg,
    abi: registrationAbi,
    functionName: "isAuthorizer",
    args: [client.account.address]
  }).catch(() => false);

  const owner = await publicClient.readContract({
    address: reg,
    abi: registrationAbi,
    functionName: "owner"
  });

  if (!authorizer && getAddress(owner) !== getAddress(client.account.address)) {
    throw Object.assign(
      new Error(
        `Admin key ${client.account.address} is not Registration owner/authorizer. Call setAuthorizer on-chain.`
      ),
      { status: 400 }
    );
  }

  const hash = await client.writeContract({
    address: reg,
    abi: registrationAbi,
    functionName: "adminRegisterAndActivate",
    args: [user, sponsor, packageId]
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, packageId };
}

export async function adminFreeUpgrade(params: {
  userWallet: string;
  packageId: number;
}): Promise<{ txHash: Hex; packageId: number }> {
  const user = getAddress(params.userWallet);
  const packageId = Math.max(1, Math.min(11, Number(params.packageId) || 0));
  if (packageId < 2) {
    throw Object.assign(new Error("Upgrade packageId must be >= 2"), { status: 400 });
  }
  const reg = registrationAddress();
  const client = walletClient();
  const publicClient = getPublicClient();

  const hash = await client.writeContract({
    address: reg,
    abi: registrationAbi,
    functionName: "adminUpgrade",
    args: [user, packageId]
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, packageId };
}
