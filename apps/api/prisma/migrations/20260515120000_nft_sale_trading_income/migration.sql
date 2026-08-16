-- Idempotent audit + guard for NFT resale trading income (one row per marketplace sale log).
CREATE TABLE "NftSaleTradingIncome" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "tokenId" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "purchasePriceUsdt" DECIMAL(18,6) NOT NULL,
    "salePriceUsdt" DECIMAL(18,6) NOT NULL,
    "profitUsdt" DECIMAL(18,6) NOT NULL,
    "tradingIncomeUsdt" DECIMAL(18,6) NOT NULL,
    "profitSharePct" INTEGER NOT NULL DEFAULT 30,
    "profitCalculated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftSaleTradingIncome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NftSaleTradingIncome_chainId_txHash_logIndex_key" ON "NftSaleTradingIncome"("chainId", "txHash", "logIndex");

CREATE INDEX "NftSaleTradingIncome_sellerUserId_createdAt_idx" ON "NftSaleTradingIncome"("sellerUserId", "createdAt");

ALTER TABLE "NftSaleTradingIncome" ADD CONSTRAINT "NftSaleTradingIncome_sellerUserId_fkey" FOREIGN KEY ("sellerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
