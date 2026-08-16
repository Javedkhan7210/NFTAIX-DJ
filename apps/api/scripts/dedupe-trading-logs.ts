/**
 * Remove duplicate TradingLog rows (same user + chain tx + token).
 * cd apps/api && npx tsx scripts/dedupe-trading-logs.ts [walletAddress]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const walletFilter = process.argv[2]?.trim().toLowerCase();
  let userId: string | undefined;
  if (walletFilter) {
    const wc = await prisma.walletConnection.findFirst({
      where: { walletAddress: { equals: walletFilter, mode: "insensitive" } },
      select: { userId: true }
    });
    if (!wc) throw new Error(`No wallet ${walletFilter}`);
    userId = wc.userId;
    console.log("Scope user", userId, walletFilter);
  }

  const rows = await prisma.tradingLog.findMany({
    where: {
      chainTxHash: { not: null },
      relatedTokenId: { not: null },
      ...(userId ? { userId } : {})
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, chainTxHash: true, relatedTokenId: true, volume: true }
  });

  const keep = new Map<string, string>();
  const deleteIds: string[] = [];
  for (const r of rows) {
    const key = `${r.userId}|${r.chainTxHash}|${r.relatedTokenId}`;
    if (keep.has(key)) deleteIds.push(r.id);
    else keep.set(key, r.id);
  }

  if (deleteIds.length === 0) {
    console.log("No duplicates found.");
    return;
  }

  const deleted = await prisma.tradingLog.deleteMany({ where: { id: { in: deleteIds } } });
  console.log(`Deleted ${deleted.count} duplicate trading log(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
