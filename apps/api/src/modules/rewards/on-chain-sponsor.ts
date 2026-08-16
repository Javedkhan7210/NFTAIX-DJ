import type { PrismaClient } from "@prisma/client";

function normalizeWalletKey(a: string): string {
  return a.trim().toLowerCase();
}

/** App user id for a connected wallet, if any. */
export async function userIdForWallet(prisma: PrismaClient, walletAddress: string): Promise<string | undefined> {
  const w = normalizeWalletKey(walletAddress);
  if (!w || w === "0x0000000000000000000000000000000000000000") return undefined;
  const wc = await prisma.walletConnection.findFirst({
    where: { walletAddress: w },
    select: { userId: true }
  });
  return wc?.userId;
}

export function effectiveActivationSponsorId(
  dbSponsorId: string | null | undefined,
  onChainReferrerUserId: string | undefined
): string | undefined {
  return dbSponsorId ?? onChainReferrerUserId;
}
