import { formatUnits, getAddress, parseAbiItem } from "viem";
import { env } from "../../shared/config/env.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { logger } from "../../shared/logger.js";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

const CHUNK = 8000n;

/**
 * Sums USDT `Transfer` logs where `to` is the wallet (matches explorer “In” for the token contract).
 * Best-effort: RPCs may cap range; uses chunked `getLogs`. Not financial advice — excludes other tokens.
 */
export async function sumInboundUsdtToWallet(walletAddress: string): Promise<{
  approxTotal: number;
  fromBlock: bigint;
  toBlock: bigint;
} | null> {
  const token = env.USDT_CONTRACT_ADDRESS?.trim();
  if (!token || env.INCOME_USDT_INBOUND_LOOKBACK_BLOCKS <= 0) return null;

  let toAddr: `0x${string}`;
  try {
    toAddr = getAddress(walletAddress.trim());
  } catch {
    return null;
  }

  const client = getPublicClient();
  let latest: bigint;
  try {
    latest = await client.getBlockNumber();
  } catch (e) {
    logger.warn(e, "chain-usdt-inbound: getBlockNumber failed");
    return null;
  }

  const lookback = BigInt(env.INCOME_USDT_INBOUND_LOOKBACK_BLOCKS);
  let fromBlock = latest > lookback ? latest - lookback : 0n;
  let sum = 0n;

  try {
    while (fromBlock <= latest) {
      const toBlock = fromBlock + CHUNK > latest ? latest : fromBlock + CHUNK;
      const logs = await client.getLogs({
        address: token as `0x${string}`,
        event: transferEvent,
        args: { to: toAddr },
        fromBlock,
        toBlock
      });
      for (const log of logs) {
        const v = log.args.value;
        if (typeof v === "bigint") sum += v;
      }
      fromBlock = toBlock + 1n;
    }
  } catch (e) {
    logger.warn(e, "chain-usdt-inbound: getLogs failed (range too large or RPC limit)");
    return null;
  }

  const dec = env.USDT_DECIMALS;
  const approxTotal = parseFloat(formatUnits(sum, dec));
  const fromB = latest > lookback ? latest - lookback : 0n;
  return { approxTotal, fromBlock: fromB, toBlock: latest };
}
