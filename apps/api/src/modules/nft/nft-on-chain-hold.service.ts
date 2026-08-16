import { type Address } from "viem";
import { env } from "../../shared/config/env.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { marketplaceAbi } from "../chain/marketplace-abi.js";

export type NftMarketUiStatus = "hold" | "for_sale" | "sold";

export type NftOwnershipFlags = {
  inUserWallet: boolean;
  escrowListed: boolean;
  legacyMapped: boolean;
};

/**
 * New stack: one held NFT per user via NFTMarketplace.heldTokenId.
 * Holding limit is 1 when the user has a held token, else 0 (no separate planInfo).
 */
export async function getRegistrationHoldingLimitForWallet(wallet: Address): Promise<bigint> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) return 0n;

  const client = getPublicClient();
  try {
    const held = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "heldTokenId",
      args: [wallet]
    });
    return held > 0n ? 1n : 0n;
  } catch {
    return 0n;
  }
}

/** Token ids currently held by the wallet on NFTMarketplace (0 or 1). */
export async function getHoldQueueTokenIdsForWallet(wallet: Address): Promise<Set<string>> {
  const mp = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!mp) return new Set();

  const client = getPublicClient();
  try {
    const held = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "heldTokenId",
      args: [wallet]
    });
    if (held > 0n) return new Set([held.toString()]);
  } catch {
    /* ignore */
  }
  return new Set();
}

/** Personal hold slot used (NFTMarketplace heldTokenId). */
export function isPersonalHoldToken(params: {
  holdingLimit: bigint;
  holdQueueTokenIds: Set<string>;
  tokenId: string;
  isSale: boolean;
  ownership: NftOwnershipFlags;
}): boolean {
  const { holdingLimit, holdQueueTokenIds, tokenId, isSale, ownership } = params;
  const { inUserWallet, escrowListed, legacyMapped } = ownership;
  const userOwns = inUserWallet || escrowListed || legacyMapped;

  if (!userOwns) return false;
  if (holdQueueTokenIds.has(tokenId)) return true;
  if (holdingLimit === 0n) return false;
  return !isSale;
}

export function resolveNftMarketUiStatus(params: {
  holdingLimit: bigint;
  holdQueueTokenIds: Set<string>;
  tokenId: string;
  isSale: boolean;
  ownership: NftOwnershipFlags;
  marketplaceAddress: Address;
  erc721Owner: Address | null;
}): NftMarketUiStatus {
  const { isSale, ownership, holdingLimit, erc721Owner, marketplaceAddress } = params;

  if (isSale || ownership.escrowListed) {
    return "for_sale";
  }

  if (
    isPersonalHoldToken({
      holdingLimit,
      holdQueueTokenIds: params.holdQueueTokenIds,
      tokenId: params.tokenId,
      isSale,
      ownership
    })
  ) {
    return "hold";
  }

  if (
    holdingLimit === 0n &&
    erc721Owner &&
    erc721Owner.toLowerCase() === marketplaceAddress.toLowerCase() &&
    (ownership.escrowListed || ownership.legacyMapped)
  ) {
    return "for_sale";
  }

  if (ownership.inUserWallet || ownership.legacyMapped) {
    return "hold";
  }

  return "for_sale";
}

/** Shared by `GET /api/nft` and hold-value metrics (marketplace heldTokenId). */
export async function marketStatusFromChainReads(params: {
  tokenId: string;
  marketplaceAddress: Address;
  ownWallets: Set<string>;
  erc721Owner: Address | null;
  isSale: boolean;
  nftCurrOwner: Address;
  mappedOwner: Address;
}): Promise<NftMarketUiStatus | null> {
  const { tokenId, marketplaceAddress: mp, ownWallets, erc721Owner, isSale, nftCurrOwner, mappedOwner } = params;

  const inUserWallet = Boolean(erc721Owner && ownWallets.has(String(erc721Owner).toLowerCase()));
  const escrowListed = Boolean(
    erc721Owner &&
      String(erc721Owner).toLowerCase() === mp.toLowerCase() &&
      isSale &&
      ownWallets.has(String(nftCurrOwner).toLowerCase())
  );
  const legacyMapped = ownWallets.has(String(mappedOwner).toLowerCase());
  const ownership: NftOwnershipFlags = { inUserWallet, escrowListed, legacyMapped };

  if (!inUserWallet && !escrowListed && !legacyMapped) {
    return null;
  }

  const registrationWallet = (
    inUserWallet
      ? String(erc721Owner)
      : legacyMapped
        ? String(mappedOwner)
        : ownWallets.has(String(nftCurrOwner).toLowerCase())
          ? String(nftCurrOwner)
          : [...ownWallets][0]
  ) as Address;

  const [holdingLimit, holdQueueTokenIds] = await Promise.all([
    getRegistrationHoldingLimitForWallet(registrationWallet),
    getHoldQueueTokenIdsForWallet(registrationWallet)
  ]);

  return resolveNftMarketUiStatus({
    holdingLimit,
    holdQueueTokenIds,
    tokenId,
    isSale,
    ownership,
    marketplaceAddress: mp,
    erc721Owner
  });
}
