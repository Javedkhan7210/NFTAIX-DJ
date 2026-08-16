import { Queue, Worker } from "bullmq";
import { env } from "../shared/config/env.js";
import { logger } from "../shared/logger.js";
import { createRedisConnection } from "../shared/redis.js";
import {
  runBurnNonCompliantLockedIncomes,
  runChainIndexer,
  runGlobalPoolDistribution,
  runInactivityDeactivation,
  runUnlockEligibleIncomes
} from "./job-runner.js";

export async function startWorkers(): Promise<void> {
  if (!env.REDIS_URL) {
    logger.warn("REDIS_URL not set; BullMQ workers not started");
    return;
  }

  const redisRoot = createRedisConnection();

  new Worker(
    "income-distribution",
    async () => {
      const r = await runUnlockEligibleIncomes();
      logger.info(r, "income-distribution: unlock");
    },
    { connection: redisRoot.duplicate() }
  );

  new Worker(
    "global-pool-distribution",
    async () => {
      const out = await runGlobalPoolDistribution();
      logger.info(out, "global-pool-distribution");
    },
    { connection: redisRoot.duplicate() }
  );

  new Worker(
    "burn-processing",
    async () => {
      await runBurnNonCompliantLockedIncomes();
    },
    { connection: redisRoot.duplicate() }
  );

  new Worker(
    "inactivity-check",
    async () => {
      const out = await runInactivityDeactivation();
      logger.info(out, "inactivity-check");
    },
    { connection: redisRoot.duplicate() }
  );

  new Worker(
    "chain-indexer",
    async () => {
      const out = await runChainIndexer();
      logger.info(out, "chain-indexer");
    },
    { connection: redisRoot.duplicate() }
  );

  const incomeQueue = new Queue("income-distribution", { connection: redisRoot.duplicate() });
  const globalQueue = new Queue("global-pool-distribution", { connection: redisRoot.duplicate() });
  const burnQueue = new Queue("burn-processing", { connection: redisRoot.duplicate() });
  const inactivityQueue = new Queue("inactivity-check", { connection: redisRoot.duplicate() });
  const chainQueue = new Queue("chain-indexer", { connection: redisRoot.duplicate() });
  await incomeQueue.add("unlock", {}, { repeat: { every: 60_000 }, jobId: "income-distribution-repeat" });
  await globalQueue.add(
    "daily",
    {},
    { repeat: { pattern: "5 0 * * *" }, jobId: "global-pool-distribution-daily" }
  );
  await burnQueue.add("sweep", {}, { repeat: { every: 120_000 }, jobId: "burn-processing-repeat" });
  await inactivityQueue.add(
    "daily",
    {},
    { repeat: { pattern: "20 0 * * *" }, jobId: "inactivity-check-daily" }
  );
  await chainQueue.add("sync", {}, { repeat: { every: 45_000 }, jobId: "chain-indexer-repeat" });

  logger.info("BullMQ workers and repeatable jobs registered");
}
