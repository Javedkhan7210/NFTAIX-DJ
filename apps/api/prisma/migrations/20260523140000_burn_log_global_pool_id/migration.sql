-- Link global-pool burn rows to a run for on-chain settlement
ALTER TABLE "BurnLog" ADD COLUMN "globalPoolId" TEXT;

CREATE INDEX "BurnLog_globalPoolId_idx" ON "BurnLog"("globalPoolId");

ALTER TABLE "BurnLog" ADD CONSTRAINT "BurnLog_globalPoolId_fkey"
  FOREIGN KEY ("globalPoolId") REFERENCES "GlobalPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;
