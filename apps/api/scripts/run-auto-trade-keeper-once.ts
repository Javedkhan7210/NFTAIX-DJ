/**
 * One-shot auto-trade job (NFTMarketplace runBot via sequential bot keeper).
 * Loads `apps/api/.env`. Executor key optional depending on which contracts are configured.
 *
 * Usage:
 * - From repo root (loads `apps/api/.env`): `npm run auto-trade:run`
 * - From `apps/api`: `npm run auto-trade:once`
 */
import "dotenv/config";
import { runAutoTradeKeeperJob } from "../src/jobs/job-runner.js";

const r = await runAutoTradeKeeperJob();
console.log(JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
