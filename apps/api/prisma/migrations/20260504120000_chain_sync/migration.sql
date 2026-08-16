-- PackageActivation on-chain fields
ALTER TABLE "PackageActivation" ADD COLUMN IF NOT EXISTS "chainTxHash" TEXT;
ALTER TABLE "PackageActivation" ADD COLUMN IF NOT EXISTS "onChain" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "PackageActivation_chainTxHash_idx" ON "PackageActivation"("chainTxHash");

-- Indexer events
CREATE TABLE IF NOT EXISTS "ChainEvent" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChainEvent_chainId_txHash_logIndex_key" ON "ChainEvent"("chainId", "txHash", "logIndex");
CREATE INDEX IF NOT EXISTS "ChainEvent_eventName_blockNumber_idx" ON "ChainEvent"("eventName", "blockNumber");
CREATE INDEX IF NOT EXISTS "ChainEvent_txHash_idx" ON "ChainEvent"("txHash");

-- Custody migration already created ChainSyncState(chain, lastScannedBlock).
-- Evolve that table to indexer shape (chainId, lastBlock), or create if missing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ChainSyncState'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ChainSyncState' AND column_name = 'chain'
  ) THEN
    ALTER TABLE "ChainSyncState" RENAME TO "ChainSyncState_custody_legacy";
    ALTER TABLE "ChainSyncState_custody_legacy" RENAME CONSTRAINT "ChainSyncState_pkey" TO "ChainSyncState_custody_legacy_pkey";

    CREATE TABLE "ChainSyncState" (
        "chainId" INTEGER NOT NULL,
        "lastBlock" BIGINT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "ChainSyncState_pkey" PRIMARY KEY ("chainId")
    );

    INSERT INTO "ChainSyncState" ("chainId", "lastBlock", "updatedAt")
    SELECT ("chain")::integer, "lastScannedBlock", COALESCE("updatedAt", CURRENT_TIMESTAMP)
    FROM "ChainSyncState_custody_legacy"
    WHERE "chain" ~ '^[0-9]+$';

    DROP TABLE "ChainSyncState_custody_legacy";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ChainSyncState'
  ) THEN
    CREATE TABLE "ChainSyncState" (
        "chainId" INTEGER NOT NULL,
        "lastBlock" BIGINT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "ChainSyncState_pkey" PRIMARY KEY ("chainId")
    );
  END IF;
END $$;
