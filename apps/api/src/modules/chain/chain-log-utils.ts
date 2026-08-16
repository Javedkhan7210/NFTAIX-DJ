import type { Hash } from "viem";

/** Confirmed on-chain log identity (non-pending). */
export type IndexedLogFields = {
  txHash: Hash;
  logIndex: number;
  blockNumber: bigint;
};

export function indexedLogFields(log: {
  transactionHash: Hash | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}): IndexedLogFields | null {
  const { transactionHash, logIndex, blockNumber } = log;
  if (transactionHash == null || logIndex == null || blockNumber == null) return null;
  return { txHash: transactionHash, logIndex, blockNumber };
}

export function chainEventLogRef(fields: IndexedLogFields): {
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
} {
  return {
    blockNumber: fields.blockNumber,
    logIndex: fields.logIndex,
    transactionHash: fields.txHash
  };
}
