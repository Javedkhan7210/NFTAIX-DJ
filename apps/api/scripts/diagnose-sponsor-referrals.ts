/**
 * Diagnose sponsor direct referrals + income mirror gaps.
 *
 *   npx tsx scripts/diagnose-sponsor-referrals.ts --wallet 0x00cb8cc13d6595ca8146e4a630c16b7a55705843
 *   npx tsx scripts/diagnose-sponsor-referrals.ts --user-id <cuid>
 *   npx tsx scripts/diagnose-sponsor-referrals.ts --user-number 147
 */
import "dotenv/config";
import { prisma } from "../src/shared/db/prisma.js";
import { env } from "../src/shared/config/env.js";
import {
  coalescedMirrorRewardsForDirectReferralActivations,
  ensureActivationFromRegistrationTx
} from "../src/modules/rewards/activation-reward-mirror.service.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function lc(a: string): string {
  return a.trim().toLowerCase();
}

async function main() {
  const wallet = arg("--wallet");
  const userIdArg = arg("--user-id");
  const userNumber = arg("--user-number");
  const runMirror = process.argv.includes("--mirror");

  let sponsor = userIdArg
    ? await prisma.user.findUnique({
        where: { id: userIdArg },
        include: { walletConnections: true }
      })
    : wallet
      ? await prisma.user.findFirst({
          where: { walletConnections: { some: { walletAddress: lc(wallet) } } },
          include: { walletConnections: true }
        })
      : await prisma.user.findFirst({
          where: { publicUserNumber: Number(userNumber) },
          include: { walletConnections: true }
        });

  if (!sponsor) {
    console.error("Sponsor user not found");
    process.exit(1);
  }

  console.log("\n=== Sponsor ===");
  console.log("id:", sponsor.id);
  console.log("publicUserNumber:", sponsor.publicUserNumber);
  console.log("referralCode:", sponsor.referralCode);
  console.log("directReferralCount (cached):", sponsor.directReferralCount);
  console.log("teamCount (cached):", sponsor.teamCount);
  console.log(
    "wallets:",
    sponsor.walletConnections.map((w) => `${w.walletAddress}${w.isPrimary ? " (primary)" : ""}`).join(", ") ||
      "(none)"
  );

  const directs = await prisma.user.findMany({
    where: { sponsorId: sponsor.id },
    select: {
      id: true,
      publicUserNumber: true,
      referralCode: true,
      createdAt: true,
      registrationTxHash: true,
      walletConnections: { where: { isPrimary: true }, take: 1, select: { walletAddress: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  console.log("\n=== Direct referrals (sponsorId match) ===");
  console.log("count:", directs.length);

  const incomeRows = await prisma.incomeLedger.findMany({
    where: { userId: sponsor.id },
    select: { id: true, sourceUserId: true, incomeType: true, amount: true, status: true, createdAt: true }
  });
  const incomeBySource = new Map<string, number>();
  for (const r of incomeRows) {
    if (!r.sourceUserId) continue;
    incomeBySource.set(r.sourceUserId, (incomeBySource.get(r.sourceUserId) ?? 0) + Number(r.amount));
  }

  let missingMirror = 0;
  for (const d of directs) {
    const walletAddr = d.walletConnections[0]?.walletAddress ?? "(no primary wallet)";
    const earned = incomeBySource.get(d.id) ?? 0;
    const acts = await prisma.packageActivation.findMany({
      where: { userId: d.id, onChain: true },
      select: { id: true, chainTxHash: true, isCurrent: true }
    });
    const distLogs = await prisma.tokenDistributionLog.count({
      where: { activation: { userId: d.id, onChain: true } }
    });
    const hasGap = earned === 0 && d.registrationTxHash;
    if (hasGap) missingMirror += 1;

    console.log("\n---");
    console.log("  user#:", d.publicUserNumber, "| code:", d.referralCode);
    console.log("  wallet:", walletAddr);
    console.log("  registered:", d.createdAt.toISOString());
    console.log("  registrationTxHash:", d.registrationTxHash ?? "(none)");
    console.log("  onChain activations:", acts.length, "| tokenDistributionLog:", distLogs);
    console.log("  sponsor earnedUsdt (ledger):", earned.toFixed(2));
    if (hasGap) console.log("  ** GAP: registered on-chain but no sponsor income mirrored **");
  }

  console.log("\n=== Sponsor income totals ===");
  const byType = new Map<string, number>();
  for (const r of incomeRows) {
    byType.set(r.incomeType, (byType.get(r.incomeType) ?? 0) + Number(r.amount));
  }
  for (const [t, v] of byType) console.log(`  ${t}: ${v.toFixed(2)}`);
  console.log("  total ledger rows:", incomeRows.length);
  console.log("  directs missing income mirror:", missingMirror);

  if (runMirror) {
    console.log("\n=== Running mirror backfill ===");
    await coalescedMirrorRewardsForDirectReferralActivations(prisma, sponsor.id, 100);
    for (const d of directs) {
      if (d.registrationTxHash) {
        const r = await ensureActivationFromRegistrationTx(prisma, d.id, d.registrationTxHash);
        console.log(`  mirror ${d.publicUserNumber}:`, r);
      }
    }
    console.log("Done — re-run without --mirror to see updated totals.");
  } else {
    console.log("\nTip: add --mirror to run backfill on this sponsor.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
