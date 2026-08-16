-- Repair: legacy `ChainSyncState` used `chain` + `lastScannedBlock` (custody migration).
-- If `prisma migrate deploy` fails on `20260504120000_chain_sync` because the table already exists,
-- run this file, then:
--   dotenv -e apps/api/.env -- prisma migrate resolve --applied 20260504120000_chain_sync
--   npm run prisma:migrate:deploy
-- Or from repo root: `npm run prisma:repair:indexer` (see root package.json).

-- Repair databases where `ChainSyncState` was created by migration
-- `20260501195945_custody_usdt_deposits` with columns (`chain`, `lastScannedBlock`),
-- while the indexer model expects (`chainId`, `lastBlock`).
-- The later `20260504120000_chain_sync` migration could not recreate the table because
-- the name already existed, leaving Prisma and Postgres out of sync.

-- PackageActivation columns (idempotent if chain_sync partially failed)
ALTER TABLE "PackageActivation" ADD COLUMN IF NOT EXISTS "chainTxHash" TEXT;
ALTER TABLE "PackageActivation" ADD COLUMN IF NOT EXISTS "onChain" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "PackageActivation_chainTxHash_idx" ON "PackageActivation"("chainTxHash");

-- ChainEvent (idempotent)
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

-- Evolve legacy ChainSyncState → indexer shape
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
    -- RENAME TABLE keeps the PK name `ChainSyncState_pkey`; free it for the new table.
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
  END IF;
END $$;

-- Half-applied repair: table was renamed to _custody_legacy but CREATE failed (e.g. duplicate PK name).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ChainSyncState_custody_legacy'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ChainSyncState'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'ChainSyncState_custody_legacy' AND c.conname = 'ChainSyncState_pkey'
    ) THEN
      ALTER TABLE "ChainSyncState_custody_legacy" RENAME CONSTRAINT "ChainSyncState_pkey" TO "ChainSyncState_custody_legacy_pkey";
    END IF;

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
  END IF;
END $$;

-- If the table was never created (edge case), create the indexer table
CREATE TABLE IF NOT EXISTS "ChainSyncState" (
    "chainId" INTEGER NOT NULL,
    "lastBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChainSyncState_pkey" PRIMARY KEY ("chainId")
);
