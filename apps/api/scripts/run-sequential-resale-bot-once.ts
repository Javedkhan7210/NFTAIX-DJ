/**
 * One-shot marketplace bot (runBot per enabled user).
 * Usage: npx tsx apps/api/scripts/run-sequential-resale-bot-once.ts
 */
import { runSequentialResaleBot } from "../src/modules/trading/resale-bot-keeper.service.js";

const r = await runSequentialResaleBot({ trigger: "admin" });
console.log(JSON.stringify(r, null, 2));
