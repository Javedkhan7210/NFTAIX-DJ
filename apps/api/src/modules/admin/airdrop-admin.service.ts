import { isAddress, erc20Abi, createWalletClient, http, parseUnits, formatUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { env } from "../../shared/config/env.js";
import { appChain, getPublicClient } from "../chain/chain-viem.js";

const MAX_RECIPIENTS = 200;

export type AirdropExplicitPreview = {
  mode: "explicit";
  tokenAddress: `0x${string}`;
  transfers: Array<{ to: `0x${string}`; amountHuman: string; amountWei: bigint }>;
};

export type AirdropIncomePercentPreview = {
  mode: "income_percent";
  tokenAddress: `0x${string}`;
  percent: number;
  lookbackDays: number;
  transfers: Array<{
    userId: string;
    to: `0x${string}`;
    amountHuman: string;
    amountWei: bigint;
    incomeSum: string;
  }>;
};

function normalizePk(pk: string): `0x${string}` {
  const t = pk.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as `0x${string}`;
}

export class AirdropAdminService {
  constructor(private readonly prisma: PrismaClient) {}

  private signerAccount() {
    const pk = env.AIRDROP_SIGNER_PRIVATE_KEY?.trim();
    if (!pk) {
      throw Object.assign(new Error("AIRDROP_SIGNER_PRIVATE_KEY not configured"), { status: 503 });
    }
    return privateKeyToAccount(normalizePk(pk));
  }

  async tokenDecimals(token: `0x${string}`): Promise<number> {
    const client = getPublicClient();
    try {
      return Number(
        await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals"
        })
      );
    } catch {
      return env.USDT_DECIMALS;
    }
  }

  async buildExplicit(params: {
    tokenAddress: string;
    transfers: Array<{ to: string; amount: string }>;
  }): Promise<AirdropExplicitPreview> {
    if (!isAddress(params.tokenAddress)) {
      throw Object.assign(new Error("Invalid token address"), { status: 400 });
    }
    const token = getAddress(params.tokenAddress) as `0x${string}`;
    const dec = await this.tokenDecimals(token);
    const out: AirdropExplicitPreview["transfers"] = [];
    let count = 0;
    for (const row of params.transfers) {
      if (++count > MAX_RECIPIENTS) {
        throw Object.assign(new Error(`At most ${MAX_RECIPIENTS} recipients per run`), { status: 400 });
      }
      if (!isAddress(row.to)) {
        throw Object.assign(new Error(`Invalid recipient ${row.to}`), { status: 400 });
      }
      const trimmed = row.amount.trim();
      const wei = parseUnits(trimmed, dec);
      if (wei <= 0n) {
        throw Object.assign(new Error(`Non-positive amount for ${row.to}`), { status: 400 });
      }
      out.push({ to: getAddress(row.to) as `0x${string}`, amountHuman: trimmed, amountWei: wei });
    }
    if (out.length === 0) {
      throw Object.assign(new Error("No transfers"), { status: 400 });
    }
    return { mode: "explicit", tokenAddress: token, transfers: out };
  }

  async buildIncomePercent(params: {
    tokenAddress: string;
    percent: number;
    lookbackDays: number;
  }): Promise<AirdropIncomePercentPreview> {
    if (!isAddress(params.tokenAddress)) {
      throw Object.assign(new Error("Invalid token address"), { status: 400 });
    }
    const token = getAddress(params.tokenAddress) as `0x${string}`;
    const dec = await this.tokenDecimals(token);
    const since = new Date(Date.now() - params.lookbackDays * 86400_000);

    const users = await this.prisma.user.findMany({
      where: {
        walletConnections: { some: { isPrimary: true, blocked: false } }
      },
      select: {
        id: true,
        walletConnections: {
          where: { isPrimary: true },
          take: 1,
          select: { walletAddress: true }
        },
        incomes: {
          where: {
            status: "unlocked",
            createdAt: { gte: since }
          },
          select: { amount: true }
        }
      },
      take: 5000
    });

    const transfers: AirdropIncomePercentPreview["transfers"] = [];
    const pct = new Decimal(params.percent).div(100);

    for (const u of users) {
      const w = u.walletConnections[0]?.walletAddress;
      if (!w || !isAddress(w)) continue;
      let sum = new Decimal(0);
      for (const inc of u.incomes) {
        sum = sum.add(inc.amount);
      }
      if (sum.lte(0)) continue;
      const alloc = sum.mul(pct);
      if (alloc.lte(0)) continue;
      const human = alloc.toDecimalPlaces(Math.min(dec, 24), 1).toString();
      let wei: bigint;
      try {
        wei = parseUnits(human, dec);
      } catch {
        continue;
      }
      if (wei <= 0n) continue;
      transfers.push({
        userId: u.id,
        to: getAddress(w) as `0x${string}`,
        amountHuman: human,
        amountWei: wei,
        incomeSum: sum.toFixed(6)
      });
      if (transfers.length >= MAX_RECIPIENTS) break;
    }

    if (transfers.length === 0) {
      throw Object.assign(new Error("No eligible recipients (check incomes and primary wallets)"), { status: 400 });
    }

    return {
      mode: "income_percent",
      tokenAddress: token,
      percent: params.percent,
      lookbackDays: params.lookbackDays,
      transfers
    };
  }

  totalWei(preview: AirdropExplicitPreview | AirdropIncomePercentPreview): bigint {
    const rows = preview.mode === "explicit" ? preview.transfers : preview.transfers;
    let t = 0n;
    for (const r of rows) {
      t += r.amountWei;
    }
    return t;
  }

  async executeOnChain(preview: AirdropExplicitPreview | AirdropIncomePercentPreview, actorId: string) {
    const account = this.signerAccount();
    const walletClient = createWalletClient({
      account,
      chain: appChain,
      transport: http(env.CHAIN_RPC_URL)
    });
    const publicClient = getPublicClient();

    const rows = preview.mode === "explicit" ? preview.transfers : preview.transfers;
    const hashes: string[] = [];
    const stored: Array<{ toAddress: string; amountWei: string; txHash: string | null }> = [];

    for (const row of rows) {
      const txHash = await walletClient.writeContract({
        address: preview.tokenAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [row.to, row.amountWei]
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 2_000, confirmations: 1 });
      hashes.push(txHash);
      stored.push({
        toAddress: row.to,
        amountWei: row.amountWei.toString(),
        txHash
      });
    }

    const total = this.totalWei(preview).toString();
    const run = await this.prisma.airdropRun.create({
      data: {
        chainId: env.CHAIN_ID,
        tokenAddress: preview.tokenAddress,
        actorId,
        recipientCount: rows.length,
        totalAmountWei: total,
        transfers: {
          create: stored.map((s) => ({
            toAddress: s.toAddress,
            amountWei: s.amountWei,
            txHash: s.txHash
          }))
        }
      }
    });

    return { runId: run.id, txHashes: hashes };
  }
}
