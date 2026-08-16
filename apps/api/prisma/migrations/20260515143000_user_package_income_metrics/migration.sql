-- CreateTable
CREATE TABLE "UserPackageIncomeMetrics" (
    "userId" TEXT NOT NULL,
    "buyVolumeUsdt" DECIMAL(18,2) NOT NULL,
    "holdNftAmountUsdt" DECIMAL(18,6) NOT NULL,
    "totalSpentUsdt" DECIMAL(18,6) NOT NULL,
    "incomeUsdt" DECIMAL(18,6) NOT NULL,
    "tradingIncomeDerivedUsdt" DECIMAL(18,6) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPackageIncomeMetrics_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserPackageIncomeMetrics" ADD CONSTRAINT "UserPackageIncomeMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
