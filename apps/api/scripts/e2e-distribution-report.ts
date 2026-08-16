/**
 * Post-run distribution report for recent wallet signups.
 * Usage: cd apps/api && npx tsx scripts/e2e-distribution-report.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAKE = Number(process.env.REPORT_USERS ?? 50);

async function main() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        publicUserNumber: true,
        referralCode: true,
        sponsorId: true,
        createdAt: true,
        walletConnections: { select: { walletAddress: true }, take: 1 },
        packageActivations: {
          where: { isCurrent: true },
          take: 1,
          include: { tier: { select: { name: true, activationAmount: true } } }
        },
        _count: {
          select: { tradingLogs: true, incomes: true }
        }
      }
    });

    const rows = [];
    for (const u of users) {
      const incomeAgg = await prisma.incomeLedger.aggregate({
        where: { userId: u.id },
        _sum: { amount: true },
        _count: true
      });
      const volumeAgg = await prisma.tradingLog.aggregate({
        where: { userId: u.id },
        _sum: { volume: true },
        _count: true
      });
      rows.push({
        publicUserNumber: u.publicUserNumber,
        wallet: u.walletConnections[0]?.walletAddress ?? null,
        package: u.packageActivations[0]?.tier?.name ?? null,
        activationUsd: Number(u.packageActivations[0]?.tier?.activationAmount ?? 0),
        sponsorId: u.sponsorId,
        tradingLogs: volumeAgg._count,
        volumeUsdt: Number(volumeAgg._sum.volume ?? 0),
        incomeLines: incomeAgg._count,
        incomeUsdt: Number(incomeAgg._sum.amount ?? 0),
        createdAt: u.createdAt.toISOString()
      });
    }

    const report = {
      at: new Date().toISOString(),
      users: rows.length,
      totals: {
        tradingLogs: rows.reduce((a, r) => a + r.tradingLogs, 0),
        volumeUsdt: Number(rows.reduce((a, r) => a + r.volumeUsdt, 0).toFixed(4)),
        incomeUsdt: Number(rows.reduce((a, r) => a + r.incomeUsdt, 0).toFixed(6))
      },
      byPackage: Object.entries(
        rows.reduce<Record<string, number>>((acc, r) => {
          const k = r.package ?? "none";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {})
      ),
      topIncome: [...rows].sort((a, b) => b.incomeUsdt - a.incomeUsdt).slice(0, 15),
      topVolume: [...rows].sort((a, b) => b.volumeUsdt - a.volumeUsdt).slice(0, 15),
      rows
    };

    const outDir = join(__dirname, "output");
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, `distribution-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2));

    console.log("========== DISTRIBUTION REPORT ==========");
    console.log("Users:", report.users);
    console.log("Totals:", report.totals);
    console.log("By package:", Object.fromEntries(report.byPackage));
    console.log("\nTop income:");
    report.topIncome.forEach((r, i) => {
      console.log(
        `  ${i + 1}. #${r.publicUserNumber} ${r.wallet?.slice(0, 10)}… ${r.package} vol$${r.volumeUsdt.toFixed(2)} income$${r.incomeUsdt.toFixed(4)}`
      );
    });
    console.log("\nSaved:", path);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
