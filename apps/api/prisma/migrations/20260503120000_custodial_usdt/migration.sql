-- AlterTable
ALTER TABLE "User" ADD COLUMN "custodialUsdtBalance" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UsdtLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsdtLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsdtLedger_userId_createdAt_idx" ON "UsdtLedger"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UsdtLedger" ADD CONSTRAINT "UsdtLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
