/**
 * Remove database-era global income history (IncomeLedger global_pool without on-chain payout).
 *
 *   npx tsx scripts/purge-db-global-pool-history.ts --dry-run
 *   npx tsx scripts/purge-db-global-pool-history.ts --execute
 *
 * Default: deletes ALL global_pool ledger rows with chainTxHash = null (includes orphans
 * after GlobalPool was deleted). Keeps rows that have a real matrix payout tx hash.
 *
 * Also removes DB-funded GlobalPool / Distribution / BurnLog rows when still present.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const dryRun = !process.argv.includes("--execute");
/** Keep global_pool rows that were paid on-chain (have chainTxHash). */
const keepOnChainPaid = !process.argv.includes("--delete-all-global-pool");

const DB_FUNDING_MODES = new Set(["database", "database_fallback"]);

type PoolMeta = {
  funding?: { mode?: string; dbSeedPlusAccrual?: number };
  onChainPayoutEnabled?: boolean;
};

function isDbFundedPool(metadata: unknown, totalAmount: Prisma.Decimal): boolean {
  const meta = metadata as PoolMeta | null;
  const mode = meta?.funding?.mode;
  if (mode && DB_FUNDING_MODES.has(mode)) return true;
  if (mode && mode.startsWith("on_chain")) return false;
  if (mode === "matrix_balance_cap") return false;
  const seed = meta?.funding?.dbSeedPlusAccrual;
  if (typeof seed === "number" && seed > 0 && mode !== "on_chain_reserve") return true;
  const total = Number(totalAmount);
  if (!mode && total >= 1000) return true;
  return false;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const allPools = await prisma.globalPool.findMany({
      select: { id: true, day: true, totalAmount: true, metadata: true, createdAt: true }
    });

    const dbPoolIds = allPools.filter((p) => isDbFundedPool(p.metadata, p.totalAmount)).map((p) => p.id);

    /** Every global_pool row without matrix payout tx (includes orphans with globalPoolId null). */
    const ledgerDeleteWhere: Prisma.IncomeLedgerWhereInput = keepOnChainPaid
      ? { incomeType: "global_pool", chainTxHash: null }
      : { incomeType: "global_pool" };

    const incomeIds = (
      await prisma.incomeLedger.findMany({
        where: ledgerDeleteWhere,
        select: { id: true }
      })
    ).map((r) => r.id);
    const incomeIdsUnpaid = incomeIds;
    const totalGlobalPoolRemaining = await prisma.incomeLedger.count({
      where: { incomeType: "global_pool" }
    });

    const burnCount = await prisma.burnLog.count({
      where: { globalPoolId: { in: dbPoolIds } }
    });
    const distCount = await prisma.globalPoolDistribution.count({
      where: { globalPoolId: { in: dbPoolIds } }
    });
    const incomeLogCount = incomeIds.length
      ? await prisma.incomeLog.count({ where: { incomeId: { in: incomeIds } } })
      : 0;

    const samplePools = allPools
      .filter((p) => dbPoolIds.includes(p.id))
      .slice(0, 8)
      .map((p) => ({
        id: p.id,
        day: p.day.toISOString().slice(0, 10),
        total: String(p.totalAmount),
        mode: (p.metadata as PoolMeta)?.funding?.mode ?? "unknown"
      }));

    const sampleIncomes = await prisma.incomeLedger.findMany({
      where: { id: { in: incomeIds.slice(0, 10) } },
      select: {
        id: true,
        userId: true,
        amount: true,
        chainTxHash: true,
        globalPoolId: true,
        createdAt: true
      }
    });

    console.log(dryRun ? "=== DRY RUN (pass --execute to delete) ===\n" : "=== EXECUTING DELETE ===\n");
    console.log("DB-funded GlobalPool runs:", dbPoolIds.length);
    console.log("Sample pools:", samplePools);
    console.log("IncomeLedger global_pool to delete:", incomeIds.length);
    console.log("IncomeLog rows:", incomeLogCount);
    console.log("BurnLog rows (db pools):", burnCount);
    console.log("GlobalPoolDistribution rows:", distCount);
    console.log("Total global_pool ledger rows in DB (before):", totalGlobalPoolRemaining);
    console.log(
      "Deleting global_pool without on-chain tx:",
      incomeIdsUnpaid.length,
      keepOnChainPaid ? "(default)" : "(--delete-all-global-pool)"
    );
    if (sampleIncomes.length) {
      console.log("\nSample incomes:", sampleIncomes);
    }

    if (dryRun) return;

    if (!dbPoolIds.length && !incomeIds.length) {
      console.log("\nNothing to delete.");
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (incomeIds.length) {
        await tx.incomeLog.deleteMany({ where: { incomeId: { in: incomeIds } } });
        await tx.incomeLedger.deleteMany({ where: { id: { in: incomeIds } } });
      }
      if (dbPoolIds.length) {
        await tx.burnLog.deleteMany({ where: { globalPoolId: { in: dbPoolIds } } });
        await tx.globalPoolDistribution.deleteMany({ where: { globalPoolId: { in: dbPoolIds } } });
        await tx.globalPool.deleteMany({ where: { id: { in: dbPoolIds } } });
      }
    });

    console.log("\nDeleted successfully.");
    console.log("Also run: npx tsx scripts/disable-db-global-pool.ts");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
