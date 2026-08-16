import type { AbiEvent } from "abitype";
import type { GetLogsParameters, GetLogsReturnType, PublicClient } from "viem";
import { env } from "../../shared/config/env.js";
import { logger } from "../../shared/logger.js";

export function isRpcGetLogsLimitError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { code?: number; message?: string; shortMessage?: string; name?: string };
  if (o.code === -32005) return true;
  if (o.name === "LimitExceededRpcError") return true;
  const m = `${o.shortMessage ?? ""} ${o.message ?? ""}`.toLowerCase();
  return m.includes("limit exceeded") || m.includes("query returned more than");
}

/**
 * `eth_getLogs` over a wide block range, split for opBNB/BSC public RPC caps.
 * On "limit exceeded", halves the chunk size and retries (down to 1 block).
 */
export async function getLogsChunked<
  const abiEvent extends AbiEvent | undefined = undefined,
  const abiEvents extends
    | readonly AbiEvent[]
    | readonly unknown[]
    | undefined = abiEvent extends AbiEvent ? [abiEvent] : undefined,
  strict extends boolean | undefined = undefined
>(
  client: PublicClient,
  params: GetLogsParameters<abiEvent, abiEvents, strict>,
  fromBlock: bigint,
  toBlock: bigint
): Promise<GetLogsReturnType<abiEvent, abiEvents, strict>> {
  const maxChunk = BigInt(Math.max(1, env.CHAIN_GET_LOGS_MAX_BLOCK_RANGE));
  const out = [] as unknown as GetLogsReturnType<abiEvent, abiEvents, strict>;

  let start = fromBlock;
  while (start <= toBlock) {
    let chunk = maxChunk;
    let end = start + chunk > toBlock ? toBlock : start + chunk;

    for (;;) {
      try {
        const logs = await client.getLogs({
          ...params,
          fromBlock: start,
          toBlock: end
        } as GetLogsParameters<abiEvent, abiEvents, strict>);
        out.push(...(logs as GetLogsReturnType<abiEvent, abiEvents, strict>));
        break;
      } catch (e) {
        if (!isRpcGetLogsLimitError(e) || chunk <= 1n) {
          throw e;
        }
        chunk = chunk / 2n;
        if (chunk < 1n) chunk = 1n;
        end = start + chunk > toBlock ? toBlock : start + chunk;
        logger.warn(
          { from: start.toString(), to: end.toString(), chunk: chunk.toString() },
          "getLogsChunked: reduced range after RPC limit"
        );
      }
    }

    start = end + 1n;
  }

  return out;
}
