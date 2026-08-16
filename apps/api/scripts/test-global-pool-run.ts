/**
 * Dry-run / integration check for global pool distribution + on-chain readiness.
 * Does NOT send transactions unless GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED=true and you pass --execute-on-chain.
 *
 * Usage:
 *   npx tsx scripts/test-global-pool-run.ts
 *   npx tsx scripts/test-global-pool-run.ts --execute-on-chain   # live txs (mainnet)
 */
import { PrismaClient } from "@prisma/client";
import { RankEngineService } from "../src/modules/ranks/rank-engine.service.js";
import {
  globalPoolPayoutEnabled,
  readOnChainGlobalFundUsdt,
  resolveGlobalPoolBurnWallet
} from "../src/modules/ranks/global-pool-chain.service.js";
import { env } from "../src/shared/config/env.js";
import { getPublicClient } from "../src/modules/chain/chain-viem.js";

const executeOnChain = process.argv.includes("--execute-on-chain");

async function main() {
  console.log("=== Global pool test ===\n");
  console.log("CHAIN_ID:", env.CHAIN_ID);
  console.log("REGISTRATION:", env.REGISTRATION_CONTRACT_ADDRESS ?? "(unset)");
  console.log("GLOBAL_POOL:", env.GLOBAL_POOL_CONTRACT_ADDRESS ?? "(unset)");
  console.log("TREASURY:", env.TREASURY_CONTRACT_ADDRESS ?? "(unset)");
  console.log("USDT:", env.USDT_CONTRACT_ADDRESS ?? "(unset)");
  console.log("GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED:", env.GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED);
  console.log("GLOBAL_POOL_PAYOUT_SOURCE:", env.GLOBAL_POOL_PAYOUT_SOURCE);
  console.log("executeOnChain flag:", executeOnChain);
  console.log("globalPoolPayoutEnabled():", globalPoolPayoutEnabled());
  console.log();

  const client = getPublicClient();
  const burnWallet = await resolveGlobalPoolBurnWallet(client);
  console.log("resolveGlobalPoolBurnWallet:", burnWallet ?? "(none)");

  const onChain = await readOnChainGlobalFundUsdt();
  console.log("\nreadOnChainGlobalFundUsdt:", JSON.stringify(onChain, null, 2));

  const prisma = new PrismaClient();
  try {
    const capRow = await prisma.rewardSetting.findUnique({ where: { key: "globalPool.useMatrixBalanceCap" } });
    console.log("\nDB settings:");
    console.log("  useMatrixBalanceCap (legacy key):", capRow?.value);

    if (globalPoolPayoutEnabled() && !executeOnChain) {
      console.log(
        "\n⚠️  On-chain payout is enabled in env but --execute-on-chain was not passed."
      );
      console.log("    Re-run with: GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED=false npx tsx scripts/test-global-pool-run.ts");
      console.log("    Or pass --execute-on-chain to send mainnet transactions.\n");
      process.exit(1);
    }

    const engine = new RankEngineService(prisma);
    const out = await engine.persistGlobalPoolRun(new Date());
    await printRunResult(out, prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function printRunResult(
  out: Awaited<ReturnType<RankEngineService["persistGlobalPoolRun"]>>,
  prisma: PrismaClient
) {
  console.log("\n--- persistGlobalPoolRun result ---");
  console.log(JSON.stringify(out, null, 2));

  if ("poolId" in out && out.poolId) {
    const burns = await prisma.burnLog.findMany({
      where: { globalPoolId: out.poolId },
      select: { id: true, amount: true, reason: true, chainTxHash: true }
    });
    console.log("\nBurnLog rows for this pool:", burns.length);
    for (const b of burns.slice(0, 15)) {
      console.log(`  ${b.reason} amount=${b.amount} tx=${b.chainTxHash ?? "pending"}`);
    }
    if (burns.length > 15) console.log(`  ... +${burns.length - 15} more`);

    const incomes = await prisma.incomeLedger.count({
      where: { globalPoolId: out.poolId, incomeType: "global_pool" }
    });
    console.log("\nIncomeLedger global_pool rows:", incomes);
  }

  console.log("\n=== Done ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
