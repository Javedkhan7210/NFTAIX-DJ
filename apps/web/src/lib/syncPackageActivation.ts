import { packageService } from "../services/packageService";
import { userService } from "../services/userService";

/**
 * If there is no current `PackageActivation` in the DB but the wallet is activated on-chain,
 * POST `/packages/sync-on-chain-activation` creates the row (fixes indexer misses).
 */
export async function syncPackageActivationIfNeeded(): Promise<void> {
  try {
    const p = await userService.profile();
    const hasCurrent = Boolean((p.data as { packageActivations?: unknown[] }).packageActivations?.length);
    if (hasCurrent) return;
    await packageService.syncOnChainActivation();
  } catch {
    /* Missing wallet session or not activated on Registration — ignore */
  }
}
