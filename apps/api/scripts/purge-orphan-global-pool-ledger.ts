/**
 * Delete leftover global_pool IncomeLedger rows (orphans after GlobalPool was removed).
 * Keeps rows that have chainTxHash (real on-chain matrix payout).
 *
 *   npx tsx scripts/purge-orphan-global-pool-ledger.ts --dry-run
 *   npx tsx scripts/purge-orphan-global-pool-ledger.ts --execute
 */
import { PrismaClient } from "@prisma/client";

const dryRun = !process.argv.includes("--execute");
const deleteAll = process.argv.includes("--delete-all");

async function main() {
  const prisma = new PrismaClient();
  try {
    const where = deleteAll
      ? { incomeType: "global_pool" as const }
      : { incomeType: "global_pool" as const, chainTxHash: null };

    const total = await prisma.incomeLedger.count({ where: { incomeType: "global_pool" } });
    const withTx = await prisma.incomeLedger.count({
      where: { incomeType: "global_pool", chainTxHash: { not: null } }
    });
    const toDelete = await prisma.incomeLedger.findMany({
      where,
      select: { id: true, amount: true, createdAt: true, chainTxHash: true, globalPoolId: true },
      orderBy: { createdAt: "desc" },
      take: 15
    });
    const deleteCount = await prisma.incomeLedger.count({ where });

    console.log(dryRun ? "=== DRY RUN ===\n" : "=== EXECUTING ===\n");
    console.log("Total global_pool rows in DB:", total);
    console.log("With on-chain tx (kept unless --delete-all):", withTx);
    console.log("Will delete:", deleteCount);
    if (toDelete.length) {
      console.log("\nSample (up to 15):", toDelete);
    }

    if (dryRun) return;
    if (deleteCount === 0) {
      console.log("\nNothing to delete.");
      return;
    }

    const ids = (
      await prisma.incomeLedger.findMany({ where, select: { id: true } })
    ).map((r) => r.id);

    await prisma.$transaction(async (tx) => {
      await tx.incomeLog.deleteMany({ where: { incomeId: { in: ids } } });
      await tx.incomeLedger.deleteMany({ where: { id: { in: ids } } });
    });

    const left = await prisma.incomeLedger.count({ where: { incomeType: "global_pool" } });
    console.log("\nDeleted:", deleteCount, "| Remaining global_pool rows:", left);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
