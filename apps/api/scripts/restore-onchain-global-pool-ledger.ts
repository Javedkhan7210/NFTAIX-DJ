/**
 * Restore May 2026 global_pool IncomeLedger rows that had real on-chain payouts.
 *
 *   npx tsx scripts/restore-onchain-global-pool-ledger.ts --dry-run
 *   npx tsx scripts/restore-onchain-global-pool-ledger.ts --execute
 */
import { PrismaClient, IncomeStatus, IncomeType, GlobalPoolRunStatus } from "@prisma/client";

const dryRun = !process.argv.includes("--execute");

const GLOBAL_POOL_ID = "cmpkg2wsi015ei7hksa0de5ke";
const POOL_DAY = new Date("2026-05-25T00:00:00.000Z");

const ROWS = [
  {
    id: "cmpkg2wtz015ki7hkl6t2gi0s",
    userId: "cmoyaw2ev0006i7bxfxrolo3r",
    amount: 50,
    chainTxHash: "0x93737fc5e4b2316a30409214733189832e2101864370b2ba05a21d184f932d6a",
    globalPoolId: GLOBAL_POOL_ID,
    createdAt: new Date("2026-05-25T00:05:01.752Z")
  },
  {
    id: "cmpkg2wuq015oi7hkpoklaayh",
    userId: "cmov6x11g000vi7qxm25x4kp9",
    amount: 25,
    chainTxHash: "0x3f1a5b1861e4ae0b341328a7b08b818c30f3fe2c134203599a80ab241c4558a2",
    globalPoolId: GLOBAL_POOL_ID,
    createdAt: new Date("2026-05-25T00:05:01.779Z")
  },
  {
    id: "cmpkg2wvf015si7hkdlrvoqf3",
    userId: "cmozvj2yi0176i7bxvwchqpa6",
    amount: 25,
    chainTxHash: "0xddb96cea7388d04c501283e4ebed4e5d473223f704cdb6af2d7a7e43df4eb729",
    globalPoolId: GLOBAL_POOL_ID,
    createdAt: new Date("2026-05-25T00:05:01.803Z")
  }
] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    const userIds = [...new Set(ROWS.map((r) => r.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, publicUserNumber: true }
    });
    const userSet = new Set(users.map((u) => u.id));
    const missingUsers = userIds.filter((id) => !userSet.has(id));

    const existing = await prisma.incomeLedger.findMany({
      where: { id: { in: ROWS.map((r) => r.id) } },
      select: { id: true, chainTxHash: true }
    });
    const pool = await prisma.globalPool.findUnique({ where: { id: GLOBAL_POOL_ID } });

    const poolTotal = ROWS.reduce((s, r) => s + r.amount, 0);

    console.log(dryRun ? "=== DRY RUN ===\n" : "=== EXECUTING RESTORE ===\n");
    console.log("Users found:", users.map((u) => `#${u.publicUserNumber} ${u.id}`));
    if (missingUsers.length) {
      console.error("Missing users (cannot restore):", missingUsers);
      process.exit(1);
    }
    console.log("GlobalPool exists:", Boolean(pool));
    console.log("Income rows already present:", existing.length, existing);
    console.log("Will restore", ROWS.length, "on-chain global_pool ledger rows");
    console.log("GlobalPool stub totalAmount (min):", poolTotal);

    if (dryRun) return;

    await prisma.$transaction(async (tx) => {
      if (!pool) {
        await tx.globalPool.create({
          data: {
            id: GLOBAL_POOL_ID,
            day: POOL_DAY,
            totalAmount: poolTotal,
            distributedAmount: poolTotal,
            status: GlobalPoolRunStatus.completed,
            createdAt: POOL_DAY,
            updatedAt: POOL_DAY,
            metadata: {
              funding: { mode: "on_chain_reserve" },
              onChainPayoutEnabled: true,
              restored: true
            }
          }
        });
      }

      for (const row of ROWS) {
        const lockedUntil = new Date(row.createdAt.getTime() + 24 * 60 * 60 * 1000);
        await tx.incomeLedger.upsert({
          where: { id: row.id },
          create: {
            id: row.id,
            userId: row.userId,
            incomeType: IncomeType.global_pool,
            amount: row.amount,
            status: IncomeStatus.unlocked,
            lockedUntil,
            globalPoolId: row.globalPoolId,
            chainTxHash: row.chainTxHash,
            createdAt: row.createdAt
          },
          update: {
            userId: row.userId,
            incomeType: IncomeType.global_pool,
            amount: row.amount,
            status: IncomeStatus.unlocked,
            lockedUntil,
            globalPoolId: row.globalPoolId,
            chainTxHash: row.chainTxHash,
            createdAt: row.createdAt
          }
        });

        const logCount = await tx.incomeLog.count({ where: { incomeId: row.id } });
        if (logCount === 0) {
          await tx.incomeLog.create({
            data: {
              incomeId: row.id,
              fromStatus: IncomeStatus.locked,
              toStatus: IncomeStatus.unlocked,
              reason: "global_pool_matrix_withdrawMatrixGlobalIncome",
              createdAt: row.createdAt
            }
          });
        }
      }
    });

    const after = await prisma.incomeLedger.findMany({
      where: { id: { in: ROWS.map((r) => r.id) } },
      select: { id: true, amount: true, chainTxHash: true, status: true }
    });
    console.log("\nRestored:", after);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
