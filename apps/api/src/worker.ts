import { startWorkers } from "./jobs/start-workers.js";
import { logger } from "./shared/logger.js";

startWorkers().catch((err) => {
  logger.error(err, "worker failed to start");
  process.exit(1);
});
