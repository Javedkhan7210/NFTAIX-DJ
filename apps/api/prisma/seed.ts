import { PrismaClient, GlobalRank } from "@prisma/client";

const prisma = new PrismaClient();

/** Must match `planPrice` / `planLimit` on NFTAIXMatrix (NftMatrix.sol). */
const PACKAGE_TIERS: { activationUsd: number; tradingLimitUsd: number }[] = [
  { activationUsd: 5, tradingLimitUsd: 50 },
  { activationUsd: 10, tradingLimitUsd: 100 },
  { activationUsd: 25, tradingLimitUsd: 250 },
  { activationUsd: 50, tradingLimitUsd: 500 },
  { activationUsd: 100, tradingLimitUsd: 1000 },
  { activationUsd: 250, tradingLimitUsd: 2500 },
  { activationUsd: 500, tradingLimitUsd: 5000 },
  { activationUsd: 1000, tradingLimitUsd: 10000 },
  { activationUsd: 2500, tradingLimitUsd: 25000 },
  { activationUsd: 5000, tradingLimitUsd: 50000 }
];

async function main() {
  const matrixNames = new Set<string>();

  for (let i = 0; i < PACKAGE_TIERS.length; i++) {
    const { activationUsd, tradingLimitUsd } = PACKAGE_TIERS[i];
    const name = `$${activationUsd}`;
    matrixNames.add(name);

    await prisma.packageTier.upsert({
      where: { name },
      update: {
        activationAmount: activationUsd,
        tradingLimit: tradingLimitUsd,
        sortOrder: i,
        isBaseEntry: activationUsd === 5,
        isActive: true
      },
      create: {
        name,
        activationAmount: activationUsd,
        tradingLimit: tradingLimitUsd,
        sortOrder: i,
        isBaseEntry: activationUsd === 5
      }
    });
  }

  await prisma.packageTier.updateMany({
    where: { name: { notIn: [...matrixNames] } },
    data: { isActive: false }
  });

  const rankRules = [
    { rank: GlobalRank.prime_member, minDirectReferrals: 10, minTeamSize: 0, globalPoolSharePct: 20 },
    { rank: GlobalRank.elite_builder, minDirectReferrals: 15, minTeamSize: 100, globalPoolSharePct: 25 },
    { rank: GlobalRank.royal_leader, minDirectReferrals: 25, minTeamSize: 250, globalPoolSharePct: 25 },
    { rank: GlobalRank.global_director, minDirectReferrals: 75, minTeamSize: 1000, globalPoolSharePct: 20 },
    { rank: GlobalRank.crown_ambassador, minDirectReferrals: 150, minTeamSize: 5000, globalPoolSharePct: 10 }
  ];

  for (const rule of rankRules) {
    await prisma.rankRule.upsert({
      where: { rank: rule.rank },
      update: rule,
      create: rule
    });
  }

  const levelUnlockJson = JSON.stringify([
    { minDirect: 0, maxLevels: 1 },
    { minDirect: 1, maxLevels: 2 },
    { minDirect: 10, maxLevels: 20 }
  ]);

  const rewardSettings: [string, string][] = [
    ["activation.directSponsorPct", "20"],
    ["activation.networkPct", "40"],
    ["activation.creatorPct", "10"],
    ["activation.burnPct", "20"],
    ["activation.liquidityPct", "5"],
    ["activation.globalPct", "5"],
    ["tokenomics.liquidityAllocationPct", "0.50"],
    ["income.visibilityLockHours", "24"],
    ["trading.dailyComplianceMinPct", "50"],
    ["trading.dailyVolumeDivisor", "1"],
    ["referral.levelUnlock", levelUnlockJson],
    ["nft.sellPercent", "10"],
    // Resale: percents are of appreciation only; must sum to 100 (matches on-chain bps/1000 ÷ 10).
    ["nft.income.sellerPct", "30"],
    ["nft.income.levelPct", "35"],
    ["nft.income.burnPct", "15"],
    ["nft.income.liquidityPct", "10"],
    ["nft.income.platformPct", "10"],
    ["globalPool.useMatrixBalanceCap", "true"]
  ];

  for (const [key, value] of rewardSettings) {
    await prisma.rewardSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  }

  const marketListings: Array<{
    tokenNumber: number;
    name: string;
    tier: string;
    priceUsdt: number;
    imageFile: string;
    sortOrder: number;
  }> = [
    { tokenNumber: 7301, name: "Engineer Panda", tier: "Rare", priceUsdt: 99, imageFile: "nft-01.png", sortOrder: 1 },
    { tokenNumber: 7302, name: "Business Agent Panda", tier: "Epic", priceUsdt: 249, imageFile: "nft-02.png", sortOrder: 2 },
    { tokenNumber: 7303, name: "NFTaix Genesis Crest", tier: "Legendary", priceUsdt: 499, imageFile: "nft-03.png", sortOrder: 3 },
    { tokenNumber: 7304, name: "Panda Vibes Studio", tier: "Rare", priceUsdt: 1.8, imageFile: "nft-04.png", sortOrder: 4 },
    { tokenNumber: 7305, name: "Cyber Doctor Panda", tier: "Epic", priceUsdt: 189, imageFile: "nft-05.png", sortOrder: 5 },
    { tokenNumber: 7306, name: "NFTaiX Astronaut Command", tier: "Legendary", priceUsdt: 599, imageFile: "nft-06.png", sortOrder: 6 },
    { tokenNumber: 7307, name: "Mecha Panda NFTaiX", tier: "Epic", priceUsdt: 329, imageFile: "nft-07.png", sortOrder: 7 },
    { tokenNumber: 7308, name: "Lunar Pod Panda", tier: "Rare", priceUsdt: 219, imageFile: "nft-08.png", sortOrder: 8 },
    { tokenNumber: 7309, name: "Rocket Panda", tier: "Legendary", priceUsdt: 799, imageFile: "nft-09.png", sortOrder: 9 },
    { tokenNumber: 7310, name: "USDT Growth Nexus", tier: "Common", priceUsdt: 49, imageFile: "nft-10.png", sortOrder: 10 },
    { tokenNumber: 7311, name: "AIX Hex Operator", tier: "Rare", priceUsdt: 129, imageFile: "nft-11.png", sortOrder: 11 }
  ];

  for (const row of marketListings) {
    await prisma.marketNftListing.upsert({
      where: { tokenNumber: row.tokenNumber },
      update: {
        name: row.name,
        tier: row.tier,
        priceUsdt: row.priceUsdt,
        imageFile: row.imageFile,
        sortOrder: row.sortOrder
      },
      create: row
    });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
