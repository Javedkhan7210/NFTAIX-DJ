/**
 * Read-only mainnet check before enabling live global pool payouts.
 *   npx tsx scripts/mainnet-global-pool-readiness.ts
 */
import { parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  globalPoolPayoutEnabled,
  globalPoolPayoutPrivateKey,
  readOnChainGlobalFundUsdt,
  resolveGlobalPoolBurnWallet
} from "../src/modules/ranks/global-pool-chain.service.js";
import { getPublicClient } from "../src/modules/chain/chain-viem.js";
import { env } from "../src/shared/config/env.js";
import { globalPoolAbi } from "../src/modules/chain/global-pool-abi.js";

async function main() {
  const client = getPublicClient();
  const pool = env.GLOBAL_POOL_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!pool) {
    console.error("GLOBAL_POOL_CONTRACT_ADDRESS required");
    process.exit(1);
  }

  const onChain = await readOnChainGlobalFundUsdt();
  const burnWallet = await resolveGlobalPoolBurnWallet(client);

  let owner: string | null = null;
  let hasDistributeDay = false;

  try {
    owner = await client.readContract({
      address: pool,
      abi: globalPoolAbi,
      functionName: "owner"
    });
  } catch (e) {
    owner = `error: ${e instanceof Error ? e.message : e}`;
  }

  if (owner && owner.startsWith("0x")) {
    try {
      const day = await client.readContract({
        address: pool,
        abi: globalPoolAbi,
        functionName: "currentDay"
      });
      await client.simulateContract({
        address: pool,
        abi: globalPoolAbi,
        functionName: "distributeDay",
        args: [day, [], [], [], [], []],
        account: owner as `0x${string}`
      });
      hasDistributeDay = true;
    } catch {
      hasDistributeDay = false;
    }
  }

  const pk = globalPoolPayoutPrivateKey();
  let signerMatchesOwner: boolean | null = null;
  if (pk && owner && owner.startsWith("0x")) {
    const acc = privateKeyToAccount(
      (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`
    );
    signerMatchesOwner = acc.address.toLowerCase() === owner.toLowerCase();
  }

  const report = {
    chainId: env.CHAIN_ID,
    globalPool: pool,
    treasury: env.TREASURY_CONTRACT_ADDRESS ?? null,
    onChain,
    burnWallet,
    globalPoolOwner: owner,
    hasDistributeDay,
    globalPoolPayoutEnabled: globalPoolPayoutEnabled(),
    signerMatchesOwner,
    readyForOnChainPayout: hasDistributeDay
      ? globalPoolPayoutEnabled() && signerMatchesOwner === true
      : false,
    note: !hasDistributeDay
      ? "GlobalPool.distributeDay simulation failed — verify contract deployment and owner key"
      : "Ready when GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED=true and payout key matches owner()"
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
