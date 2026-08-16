/**
 * Legacy admin (`subscribeOwner` / `addNewPakage`) removed.
 * Use Registration.activate / upgrade on the new NFTAIX stack.
 */

export type SubscribeOwnerParams = {
  userAddresses: `0x${string}`[];
  referrerAddresses: `0x${string}`[];
  level: number;
  isBlockBool: boolean;
};

export type UpdateRegistrationPlanParams = {
  index: number;
  planPriceWei: bigint;
  planLimitWei: bigint;
  holdingNft: number;
  directCount: number;
  newTotalLevel: number;
};

const LEGACY_REMOVED =
  "legacy removed — use new Registration/NFTMarketplace (legacy admin plan admin disabled)";

export class RegistrationAdminService {
  isConfigured(): boolean {
    return false;
  }

  async executeSubscribeOwner(_params: SubscribeOwnerParams): Promise<{ txHash: `0x${string}` }> {
    throw Object.assign(new Error(LEGACY_REMOVED), { status: 410 });
  }

  async executeUpdatePlan(_params: UpdateRegistrationPlanParams): Promise<{ txHash: `0x${string}` }> {
    throw Object.assign(new Error(LEGACY_REMOVED), { status: 410 });
  }
}
