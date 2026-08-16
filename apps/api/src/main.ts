import "./shared/json-bigint.js";
import "express-async-errors";
import { startAutoTradeKeeperInterval } from "./jobs/auto-trade-interval.js";
import { runChainIndexer } from "./jobs/job-runner.js";
import { startScheduledJobsFallback } from "./jobs/scheduled-jobs.js";
import { createApp } from "./server/app.js";
import { env } from "./shared/config/env.js";
import { logger } from "./shared/logger.js";

setImmediate(() => {
  void runChainIndexer()
    .then((r) => logger.info(r, "chain indexer: startup sync"))
    .catch((e) => logger.error(e));
});

startScheduledJobsFallback();
startAutoTradeKeeperInterval();

const app = createApp();
app.listen(env.PORT, () => {
  logger.info(`NFTaix API listening on port ${env.PORT}`);
});
