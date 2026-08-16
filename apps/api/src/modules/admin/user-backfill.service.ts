import type { PrismaClient } from "@prisma/client";
import { parseAbi } from "viem";
import { env } from "../../shared/config/env.js";
import { generateReferralCodeCandidate } from "../../utils/referral-code.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { ReferralService } from "../referral/referral.service.js";

function normalizeWalletAddress(address: string): string {
  return address.trim().toLowerCase();
}

function registrationAddress(): `0x${string}` | null {
  const a = env.REGISTRATION_CONTRACT_ADDRESS;
  return a ? (a as `0x${string}`) : null;
}

async function ensureUniqueReferralCode(prisma: PrismaClient): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateReferralCodeCandidate();
    const clash = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!clash) return code;
  }
  throw new Error("Could not allocate referral code");
}

export async function backfillUserFromRegistrationWallet(prisma: PrismaClient, walletAddress: string) {
  const address = normalizeWalletAddress(walletAddress);
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    throw Object.assign(new Error("Invalid wallet address"), { status: 400 });
  }

  const existing = await prisma.walletConnection.findUnique({
    where: { walletAddress: address },
    include: { user: true }
  });
  if (existing) {
    return { user: existing.user, created: false };
  }

  const registration = registrationAddress();
  if (!registration) {
    throw Object.assign(new Error("REGISTRATION_CONTRACT_ADDRESS is not configured on the server."), {
      status: 500
    });
  }

  const client = getPublicClient();
  const registrationReadAbi = parseAbi([
    "function users(address account) view returns (bool registered, bool activated, bool permanentlyInactive, address sponsor, uint8 packageId, uint256 tradingLimit, uint256 activatedAt, uint256 lastUpgradeAt, uint256 directCount)"
  ]);

  let registered = false;
  let sponsorWalletOnChain = "";
  try {
    const user = await client.readContract({
      address: registration,
      abi: registrationReadAbi,
      functionName: "users",
      args: [address as `0x${string}`]
    });
    registered = Boolean(user[0]);
    sponsorWalletOnChain = String(user[3] ?? "").toLowerCase();
  } catch {
    throw Object.assign(
      new Error("Chain check failed. Verify CHAIN_RPC_URL and REGISTRATION_CONTRACT_ADDRESS."),
      { status: 502 }
    );
  }

  if (!registered) {
    throw Object.assign(new Error("Wallet is not registered on-chain (Registration.users)."), { status: 404 });
  }

  let sponsorId: string | null = null;
  if (/^0x[a-f0-9]{40}$/.test(sponsorWalletOnChain)) {
    const sponsorWallet = await prisma.walletConnection.findUnique({
      where: { walletAddress: sponsorWalletOnChain },
      select: { userId: true }
    });
    sponsorId = sponsorWallet?.userId ?? null;
  }

  const referralCode = await ensureUniqueReferralCode(prisma);
  const referrals = new ReferralService(prisma);

  const user = await prisma.$transaction(async (tx) => {
    return tx.user.create({
      data: {
        email: null,
        passwordHash: null,
        referralCode,
        sponsorId,
        custodialUsdtBalance: 0,
        walletConnections: {
          create: { chain: "opbnb", walletAddress: address, isPrimary: true, lastSignatureAt: new Date() }
        }
      }
    });
  });

  await referrals.attachNewUserToTree(user.id, sponsorId);
  return { user, created: true };
}

