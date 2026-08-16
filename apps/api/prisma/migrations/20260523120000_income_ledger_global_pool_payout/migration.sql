-- AlterTable
ALTER TABLE "IncomeLedger" ADD COLUMN "globalPoolId" TEXT,
ADD COLUMN "chainTxHash" TEXT;

-- CreateIndex
CREATE INDEX "IncomeLedger_globalPoolId_idx" ON "IncomeLedger"("globalPoolId");

-- CreateIndex
CREATE INDEX "IncomeLedger_chainTxHash_idx" ON "IncomeLedger"("chainTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeLedger_globalPoolId_userId_key" ON "IncomeLedger"("globalPoolId", "userId");

-- AddForeignKey
ALTER TABLE "IncomeLedger" ADD CONSTRAINT "IncomeLedger_globalPoolId_fkey" FOREIGN KEY ("globalPoolId") REFERENCES "GlobalPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;
