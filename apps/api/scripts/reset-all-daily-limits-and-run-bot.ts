/**
 * CLI: reset all users' daily trading allowance for the current period, then run the NFT bot once.
 * Usage: npx tsx apps/api/scripts/reset-all-daily-limits-and-run-bot.ts
 */
import { resetAllUsersDailyLimitAndRunBot } from "../src/modules/admin/admin-reset-all-daily.service.js";

const out = await resetAllUsersDailyLimitAndRunBot({});
console.log(JSON.stringify(out, null, 2));
