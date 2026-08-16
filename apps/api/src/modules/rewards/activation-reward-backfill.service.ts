import type { PrismaClient } from "@prisma/client";
import { logger } from "../../shared/logger.js";
import { tryMirrorActivationRewardsForActivation } from "./activation-reward-mirror.service.js";

/**
 * Creates app `IncomeLedger` rows for on-chain activations that never ran through
 * `processActivationDistribution` (indexer missed wallet, registration-sync without tx hash, etc.).
 */
export async function backfillMissingOnChainActivationRewards(
  prisma: PrismaClient,
  limit = 200
): Promise<{ processed: number; candidates: number; errors: string[] }> {
  const logged = await prisma.tokenDistributionLog.findMany({ select: { activationId: true } });
  const loggedSet = new Set(logged.map((x) => x.activationId));

  const candidates = await prisma.packageActivation.findMany({
    where: { onChain: true },
    include: { tier: true },
    orderBy: { activatedAt: "asc" }
  });

  const missing = candidates.filter((a) => !loggedSet.has(a.id)).slice(0, limit);

  const errors: string[] = [];
  let processed = 0;

  for (const pa of missing) {
    const r = await tryMirrorActivationRewardsForActivation(prisma, pa.id);
    if (r.ok) processed += 1;
    else if (r.reason && r.reason !== "already_recorded" && r.reason !== "not_found_or_not_onchain") {
      errors.push(`${pa.id}: ${r.reason}`);
      logger.warn({ activationId: pa.id, reason: r.reason }, "backfill activation rewards skipped/failed");
    }
  }

  return { processed, candidates: missing.length, errors };
}
