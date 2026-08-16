import { Prisma, type PrismaClient } from "@prisma/client";
import { getPublicClient } from "../chain/chain-viem.js";
import { env } from "../../shared/config/env.js";
import { registrationAbi } from "../chain/registration-abi.js";
import { PACKAGE_USD_BY_ID } from "./package-usd.js";

function usdForPackageId(id: number): number | undefined {
  return PACKAGE_USD_BY_ID[id];
}

export async function backfillPackageActivationTxFromChainEvents(
  _prisma: PrismaClient,
  _userId: string
): Promise<void> {
  // Legacy SubscribeEmit backfill disabled — new stack uses Activated events / registrationTxHash.
}

export type RegistrationSyncResult =
  | { synced: true; already: boolean; activationId: string; tierName: string }
  | { synced: false; reason: "registration_not_configured" | "no_primary_wallet" | "not_on_registration" | "invalid_level" | "no_tier" };

/**
 * Aligns PackageActivation with Registration.users(wallet).packageId.
 */
export async function syncPackageActivationFromRegistration(
  prisma: PrismaClient,
  userId: string
): Promise<RegistrationSyncResult> {
  const regAddr = env.REGISTRATION_CONTRACT_ADDRESS;
  if (!regAddr) {
    return { synced: false, reason: "registration_not_configured" };
  }

  const connections = await prisma.walletConnection.findMany({
    where: { userId },
    orderBy: [{ isPrimary: "desc" }, { connectedAt: "asc" }]
  });
  if (connections.length === 0) {
    return { synced: false, reason: "no_primary_wallet" };
  }

  const client = getPublicClient();
  const addr = regAddr as `0x${string}`;

  let packageId = 0;
  let found = false;
  for (const wc of connections) {
    const w = wc.walletAddress as `0x${string}`;
    const user = await client.readContract({
      address: addr,
      abi: registrationAbi,
      functionName: "users",
      args: [w]
    });
    if (user[0] && user[1]) {
      packageId = Number(user[4]);
      found = true;
      break;
    }
  }

  if (!found || packageId < 1) {
    return { synced: false, reason: "not_on_registration" };
  }

  const usd = usdForPackageId(packageId);
  if (usd == null) {
    return { synced: false, reason: "invalid_level" };
  }

  const tier = await prisma.packageTier.findFirst({
    where: { activationAmount: new Prisma.Decimal(usd), isActive: true },
    orderBy: { sortOrder: "asc" }
  });
  if (!tier) {
    return { synced: false, reason: "no_tier" };
  }

  const current = await prisma.packageActivation.findFirst({
    where: { userId, isCurrent: true }
  });
  if (current?.tierId === tier.id && current.onChain) {
    return { synced: true, already: true, activationId: current.id, tierName: tier.name };
  }

  await prisma.packageActivation.updateMany({
    where: { userId, isCurrent: true },
    data: { isCurrent: false }
  });

  const created = await prisma.packageActivation.create({
    data: {
      userId,
      tierId: tier.id,
      isCurrent: true,
      onChain: true,
      activatedAt: new Date()
    }
  });

  return { synced: true, already: false, activationId: created.id, tierName: tier.name };
}
