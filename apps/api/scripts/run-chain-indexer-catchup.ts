/**
 * Runs the chain indexer in a loop until the DB is caught up to the chain tip
 * (each `syncRange` advances up to 500 blocks). Loads `apps/api/.env`.
 *
 * Indexes Registration (Registered/Activated/Upgraded) + NFTMarketplace (Purchased/Listed).
 *
 * Usage from `apps/api`: `npm run chain:catchup`
 */
import "dotenv/config";
import { runChainIndexer } from "../src/jobs/job-runner.js";
import { prisma } from "../src/shared/db/prisma.js";

const maxIterations = 5000;
for (let i = 1; i <= maxIterations; i++) {
  const r = await runChainIndexer();
  if (r && typeof r === "object" && "skipped" in r) {
    console.log(JSON.stringify(r));
    await prisma.$disconnect();
    process.exit(0);
  }
  const row = r as { processed: number; fromBlock: string; toBlock: string };
  console.log(JSON.stringify(row, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  if (BigInt(row.fromBlock) > BigInt(row.toBlock)) {
    console.log(`Caught up after ${i} iteration(s).`);
    await prisma.$disconnect();
    process.exit(0);
  }
}
console.error(`Stopped after ${maxIterations} iterations (still behind?).`);
await prisma.$disconnect();
process.exit(1);
