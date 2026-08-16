import {
  createWalletClient,
  formatEther,
  http,
  isAddress,
  type Address,
  type Hash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../shared/config/env.js";
import { appChain, getPublicClient } from "../chain/chain-viem.js";
import { marketplaceAbi } from "../chain/marketplace-abi.js";

function normalizePk(pk: string): `0x${string}` {
  const t = pk.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as `0x${string}`;
}

export type NftMintQuote = {
  unitPriceWei: string;
  unitPriceUsdt: string;
  totalWei: string;
  totalUsdt: string;
  minted: string;
  maxSupply: string;
  remaining: string;
  queueLength: string;
  burnThresholdUsdt: string;
};

/**
 * Admin on-chain mint/burn against NFTMarketplace (owner key).
 * Mint seeds FIFO via `adminMintToQueue` — shows on public Market NFT tab.
 */
export class AdminNftMintService {
  private marketplace(): Address {
    const a = env.MARKETPLACE_CONTRACT_ADDRESS?.trim();
    if (!a) throw Object.assign(new Error("MARKETPLACE_CONTRACT_ADDRESS not set"), { status: 503 });
    return a as Address;
  }

  mintPrivateKey(): `0x${string}` {
    const pk = env.MARKETPLACE_OWNER_PRIVATE_KEY?.trim() || env.CONTRACT_ADMIN_PRIVATE_KEY?.trim() || env.CHAIN_PRIVATE_KEY;
    return normalizePk(pk);
  }

  ownerPrivateKey(): `0x${string}` {
    return this.mintPrivateKey();
  }

  defaultMintRecipient(): Address {
    return privateKeyToAccount(this.ownerPrivateKey()).address;
  }

  resolveRecipient(raw?: string): Address {
    const t = raw?.trim();
    if (t && isAddress(t)) return t as Address;
    return this.defaultMintRecipient();
  }

  private wallet() {
    const account = privateKeyToAccount(this.ownerPrivateKey());
    return {
      account,
      client: createWalletClient({
        account,
        chain: appChain,
        transport: http(env.CHAIN_RPC_URL)
      })
    };
  }

  mintDefaults() {
    const owner = this.defaultMintRecipient();
    return {
      defaultRecipient: owner,
      marketplaceOwner: owner,
      paidMintWallet: owner,
      marketplace: this.marketplace(),
      mode: "adminMintToQueue" as const,
      message:
        "Owner mints into the on-chain FIFO sell queue (adminMintToQueue). No USDT. Appears on the public NFT market."
    };
  }

  async preflight(_recipient?: string): Promise<{ ready: boolean; issues: string[] }> {
    const issues: string[] = [];
    if (!env.MARKETPLACE_CONTRACT_ADDRESS?.trim()) issues.push("MARKETPLACE_CONTRACT_ADDRESS missing");
    if (!env.CHAIN_RPC_URL?.trim()) issues.push("CHAIN_RPC_URL missing");
    try {
      this.ownerPrivateKey();
    } catch {
      issues.push("MARKETPLACE_OWNER_PRIVATE_KEY / CHAIN_PRIVATE_KEY missing");
    }
    const client = getPublicClient();
    try {
      await client.readContract({
        address: this.marketplace(),
        abi: marketplaceAbi,
        functionName: "nextListPrice"
      });
    } catch (e) {
      issues.push(`Marketplace read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const ownerOnChain = await client
      .readContract({
        address: this.marketplace(),
        abi: marketplaceAbi,
        functionName: "owner"
      })
      .catch(() => null);
    const signer = this.defaultMintRecipient();
    if (ownerOnChain && String(ownerOnChain).toLowerCase() !== signer.toLowerCase()) {
      issues.push(
        `Signer ${signer} is not marketplace owner ${ownerOnChain}. Set MARKETPLACE_OWNER_PRIVATE_KEY to the owner key.`
      );
    }
    return { ready: issues.length === 0, issues };
  }

  async quote(quantity = 1): Promise<NftMintQuote> {
    const qty = Math.min(50, Math.max(1, Math.floor(quantity)));
    const client = getPublicClient();
    const mp = this.marketplace();
    const [mintPrice, qLen, burnTh, appreciationBps] = await Promise.all([
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "mintPrice" }),
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "queueLength" }),
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "burnThreshold" }),
      client
        .readContract({ address: mp, abi: marketplaceAbi, functionName: "appreciationBps" })
        .catch(() => 1000n)
    ]);
    const bps = 10_000n;
    const ask = (mintPrice * (bps + BigInt(appreciationBps))) / bps;
    if (ask >= burnTh) {
      throw Object.assign(new Error(`Ask $${formatEther(ask)} hits burn threshold`), { status: 400 });
    }
    const total = ask * BigInt(qty);
    return {
      unitPriceWei: ask.toString(),
      unitPriceUsdt: formatEther(ask),
      totalWei: total.toString(),
      totalUsdt: formatEther(total),
      minted: "0",
      maxSupply: "∞",
      remaining: "∞",
      queueLength: qLen.toString(),
      burnThresholdUsdt: formatEther(burnTh)
    };
  }

  /** Seed FIFO queue — public Market NFT tab. `recipient` ignored (listings are marketplace-owned). */
  async mintPrimaryToRecipient(params: {
    recipient?: string | Address;
    quantity?: number;
    label?: string;
  }): Promise<{
    tokenIds: string[];
    mintTxHashes: string[];
    transferTxHash: string | null;
    txHashes: string[];
    listedOnMarket: boolean;
  }> {
    return this.mintAdminFreePrimaryToRecipient(params);
  }

  async mintAdminFreePrimaryToRecipient(params: {
    recipient?: string | Address;
    quantity?: number;
    label?: string;
  }): Promise<{
    tokenIds: string[];
    mintTxHash: string;
    transferTxHash: string | null;
    listedOnMarket: boolean;
    txHashes: string[];
  }> {
    const quantity = Math.min(50, Math.max(1, Math.floor(params.quantity ?? 1)));
    await this.quote(quantity);
    const pre = await this.preflight();
    if (!pre.ready) {
      throw Object.assign(new Error(pre.issues.join("; ") || "Mint preflight failed"), { status: 503 });
    }

    const client = getPublicClient();
    const mp = this.marketplace();
    const beforePeek = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "peekNext"
    });
    const qBefore = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "queueLength"
    });

    const { account, client: wallet } = this.wallet();
    const mintTxHash = await wallet.writeContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "adminMintToQueue",
      args: [BigInt(quantity)],
      account,
      chain: appChain
    });
    await client.waitForTransactionReceipt({ hash: mintTxHash as Hash });

    const qAfter = await client.readContract({
      address: mp,
      abi: marketplaceAbi,
      functionName: "queueLength"
    });
    const tokenIds: string[] = [];
    // Newly minted sit at the end of the FIFO — scan last `quantity` entries
    const start = Number(qAfter) > quantity ? Number(qAfter) - quantity : 0;
    for (let i = start; i < Number(qAfter); i++) {
      try {
        const entry = await client.readContract({
          address: mp,
          abi: marketplaceAbi,
          functionName: "queueAt",
          args: [BigInt(i)]
        });
        tokenIds.push(entry[0].toString());
      } catch {
        break;
      }
    }
    if (tokenIds.length === 0 && beforePeek[0] === 0n && qBefore === 0n) {
      const peek = await client.readContract({
        address: mp,
        abi: marketplaceAbi,
        functionName: "peekNext"
      });
      if (peek[0] > 0n) tokenIds.push(peek[0].toString());
    }

    void params.label;
    void params.recipient;

    return {
      tokenIds,
      mintTxHash,
      transferTxHash: null,
      listedOnMarket: true,
      txHashes: [mintTxHash]
    };
  }

  async quoteBurnListedNft(tokenId: string): Promise<Record<string, unknown>> {
    const client = getPublicClient();
    const mp = this.marketplace();
    const tid = BigInt(tokenId);
    const [listed, price, seller, peek, qLen] = await Promise.all([
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "listed", args: [tid] }),
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "listPrice", args: [tid] }),
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "sellerOf", args: [tid] }),
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "peekNext" }),
      client.readContract({ address: mp, abi: marketplaceAbi, functionName: "queueLength" })
    ]);
    const isHead = qLen > 0n && peek[0] === tid;
    return {
      tokenId,
      seller,
      isSale: listed,
      listBasePriceWei: price.toString(),
      payWei: "0",
      payUsdt: "0",
      note: isHead
        ? "FIFO head — adminBurnToken will dequeue and burn (no USDT)."
        : listed
          ? "Listed but not FIFO head — burn will revert. Buy/dequeue until it is next, or burn another id."
          : "Not listed — adminBurnToken will burn if it exists.",
      canBurn: Boolean(isHead || !listed),
      queueLength: qLen.toString()
    };
  }

  async burnListedNftByMarketplaceOwner(tokenId: string): Promise<{ txHash: `0x${string}` }> {
    return this.forceBurnNftByMarketplaceOwner(tokenId);
  }

  async quoteForceBurnNft(tokenId: string): Promise<Record<string, unknown>> {
    return this.quoteBurnListedNft(tokenId);
  }

  async forceBurnNftByMarketplaceOwner(tokenId: string): Promise<{ txHash: `0x${string}` }> {
    const tid = BigInt(tokenId);
    const pre = await this.preflight();
    if (!pre.ready) {
      throw Object.assign(new Error(pre.issues.join("; ") || "Burn preflight failed"), { status: 503 });
    }
    const { account, client: wallet } = this.wallet();
    const client = getPublicClient();
    const txHash = await wallet.writeContract({
      address: this.marketplace(),
      abi: marketplaceAbi,
      functionName: "adminBurnToken",
      args: [tid],
      account,
      chain: appChain
    });
    await client.waitForTransactionReceipt({ hash: txHash as Hash });
    return { txHash: txHash as `0x${string}` };
  }
}
