/**
 * Legacy AutoTradeModule removed.
 * Delegates to NFTMarketplace `runBot` via auto-trade-keeper.
 */
import { runAutoTradeKeeperOnce } from "./auto-trade-keeper.service.js";

export type AutoTradeModuleKeeperResult =
  | { attempts: number; successes: number; failures: number }
  | { skipped: string };

export async function runAutoTradeModuleKeeper(): Promise<AutoTradeModuleKeeperResult> {
  const r = await runAutoTradeKeeperOnce();
  if (r.errors.length === 1 && r.usersTried === 0 && r.buys === 0) {
    return { skipped: r.errors[0]! };
  }
  return {
    attempts: r.usersTried,
    successes: r.buys,
    failures: r.errors.length
  };
}
