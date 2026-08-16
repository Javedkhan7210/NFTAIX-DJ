-- AlterTable
ALTER TABLE "TradingLog" ADD COLUMN IF NOT EXISTS "relatedTokenId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TradingLog_relatedTokenId_idx" ON "TradingLog"("relatedTokenId");
