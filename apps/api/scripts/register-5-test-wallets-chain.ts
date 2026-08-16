/**
 * Admin free register+activate 5 test wallets in a referral chain.
 * Wallet 1 → old activated user; W2→W1, W3→W2, W4→W3, W5→W4
 *
 * cd apps/api && npx tsx scripts/register-5-test-wallets-chain.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getAddress, parseAbi } from "viem";
import { adminFreeRegisterAndActivate } from "../src/modules/admin/admin-free-registration.service.js";
import { getPublicClient } from "../src/modules/chain/chain-viem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN = join(__dirname, "output", "test-wallets-5-new.json");
const OUT = join(__dirname, "output", "test-wallets-5-new-registered.json");

/** Old user already activated on NEW Registration contract. */
const ROOT_SPONSOR = "0xDAF49367f4A62fCD39A91b94E5b239dC1f6EF6a4";

const registrationAbi = parseAbi([
  "function users(address) view returns (bool registered, bool activated, bool permanentlyInactive, address sponsor, uint8 packageId, uint256 tradingLimit, uint256 activatedAt, uint256 lastUpgradeAt, uint256 directCount)"
]);

async function readUser(address: string) {
  const client = getPublicClient();
  const u = await client.readContract({
    address: process.env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}`,
    abi: registrationAbi,
    functionName: "users",
    args: [getAddress(address)]
  });
  return {
    registered: u[0],
    activated: u[1],
    sponsor: u[3],
    packageId: Number(u[4]),
    directCount: Number(u[8])
  };
}

async function main() {
  const data = JSON.parse(readFileSync(IN, "utf8")) as {
    wallets: Array<{ index: number; address: string; privateKey: string; bnb?: string; usdt?: string }>;
  };

  const root = getAddress(ROOT_SPONSOR);
  const rootState = await readUser(root);
  console.log("Root sponsor", root, rootState);
  if (!rootState.registered || !rootState.activated) {
    throw new Error(`Root sponsor ${root} is not registered+activated on current Registration contract`);
  }

  const results: Array<{
    index: number;
    address: string;
    privateKey: string;
    sponsor: string;
    txHash: string;
    packageId: number;
    onChain?: Awaited<ReturnType<typeof readUser>>;
  }> = [];

  let sponsor = root;
  for (const w of data.wallets) {
    const user = getAddress(w.address);
    const before = await readUser(user);
    if (before.registered && before.activated) {
      console.log(`Wallet ${w.index} ${user} already active — skip`);
      results.push({
        index: w.index,
        address: user,
        privateKey: w.privateKey,
        sponsor: before.sponsor,
        txHash: "already-active",
        packageId: Number(before.packageId)
      });
      sponsor = user;
      continue;
    }

    console.log(`Register W${w.index} ${user} under sponsor ${sponsor}…`);
    const { txHash, packageId } = await adminFreeRegisterAndActivate({
      userWallet: user,
      sponsorWallet: sponsor,
      packageId: 1
    });
    const after = await readUser(user);
    console.log(`  tx ${txHash}`);
    console.log(`  on-chain`, after);

    results.push({
      index: w.index,
      address: user,
      privateKey: w.privateKey,
      sponsor,
      txHash,
      packageId,
      onChain: after
    });
    sponsor = user;
  }

  const out = {
    ...data,
    referralChain: {
      rootSponsor: root,
      chain: [root, ...results.map((r) => r.address)]
    },
    registeredAt: new Date().toISOString(),
    wallets: results
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log("\nReferral chain:");
  out.referralChain.chain.forEach((a, i) => console.log(`  ${i === 0 ? "ROOT" : `W${i}`}: ${a}`));
  console.log("\nSaved", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
