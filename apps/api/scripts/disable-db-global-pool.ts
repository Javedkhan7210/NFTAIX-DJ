/**
 * Disable legacy database-funded global pool (on-chain only after API deploy).
 *
 *   npx tsx scripts/disable-db-global-pool.ts
 *   npx tsx scripts/disable-db-global-pool.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";

const LEGACY_KEYS = [
  "globalPool.dailySeedAmount",
  "globalPool.activationAccrual",
  "globalPool.fundFromOnChain"
] as const;

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const prisma = new PrismaClient();
  try {
    const before = await prisma.rewardSetting.findMany({
      where: { key: { in: [...LEGACY_KEYS] } }
    });
    console.log("Before:", before.map((r) => ({ key: r.key, value: r.value })));

    if (dryRun) {
      console.log("\n(dry-run) Would set dailySeedAmount=0, activationAccrual=0, delete fundFromOnChain");
      return;
    }

    await prisma.rewardSetting.upsert({
      where: { key: "globalPool.dailySeedAmount" },
      create: { key: "globalPool.dailySeedAmount", value: "0" },
      update: { value: "0" }
    });
    await prisma.rewardSetting.upsert({
      where: { key: "globalPool.activationAccrual" },
      create: { key: "globalPool.activationAccrual", value: "0" },
      update: { value: "0" }
    });
    const deleted = await prisma.rewardSetting.deleteMany({
      where: { key: "globalPool.fundFromOnChain" }
    });

    const after = await prisma.rewardSetting.findMany({
      where: { key: { in: [...LEGACY_KEYS] } }
    });
    console.log("\nAfter:", after.map((r) => ({ key: r.key, value: r.value })));
    console.log(`Removed fundFromOnChain rows: ${deleted.count}`);
    console.log("\nDone. Redeploy API with on-chain-only global pool code + set GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED=true.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
