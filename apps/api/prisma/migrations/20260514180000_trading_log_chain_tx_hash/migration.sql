-- AlterTable (idempotent: column may already exist from manual fix / partial apply)
ALTER TABLE "TradingLog" ADD COLUMN IF NOT EXISTS "chainTxHash" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TradingLog_chainTxHash_idx" ON "TradingLog"("chainTxHash");
