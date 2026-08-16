-- Upline NFT resale level income (`SaleLevelDistribute` on matrix).

CREATE TABLE "NftSaleLevelIncome" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "tokenId" TEXT NOT NULL,
    "treeLine" INTEGER NOT NULL,
    "amountUsdt" DECIMAL(18,6) NOT NULL,
    "recipientWallet" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "sellerWallet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftSaleLevelIncome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NftSaleLevelIncome_chainId_txHash_logIndex_key" ON "NftSaleLevelIncome"("chainId", "txHash", "logIndex");
CREATE INDEX "NftSaleLevelIncome_recipientUserId_createdAt_idx" ON "NftSaleLevelIncome"("recipientUserId", "createdAt");
CREATE INDEX "NftSaleLevelIncome_tokenId_idx" ON "NftSaleLevelIncome"("tokenId");

ALTER TABLE "NftSaleLevelIncome" ADD CONSTRAINT "NftSaleLevelIncome_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
