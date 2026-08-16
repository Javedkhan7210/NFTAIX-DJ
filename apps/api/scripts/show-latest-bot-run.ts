import { prisma } from "../src/shared/db/prisma.js";

const run = await prisma.botPurchaseRun.findFirst({
  orderBy: { startedAt: "desc" },
  include: { attempts: { orderBy: { sortOrder: "asc" } } }
});
if (!run) {
  console.log("no bot runs");
} else {
  console.log(
    JSON.stringify(
      {
        runId: run.id,
        status: run.status,
        trigger: run.trigger,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        summary: run.summary,
        attemptCount: run.attempts.length,
        attempts: run.attempts.map((a) => ({
          sortOrder: a.sortOrder,
          status: a.status,
          tokenId: a.tokenId,
          effectivePayUsdt: a.effectivePayUsdt?.toString() ?? null,
          failureReason: a.failureReason,
          chainTxHash: a.chainTxHash
        }))
      },
      null,
      2
    )
  );
}
await prisma.$disconnect();
