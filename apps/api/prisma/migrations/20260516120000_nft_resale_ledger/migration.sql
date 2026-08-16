-- NFT resale ledger: ownership transfers, max-price burns, post-burn splits

CREATE TABLE "NftOwnershipHistory" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "tokenId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "fromWallet" TEXT NOT NULL,
    "toWallet" TEXT NOT NULL,
    "priceUsdt" DECIMAL(18,6) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'resale',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftOwnershipHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NftOwnershipHistory_chainId_txHash_logIndex_key" ON "NftOwnershipHistory"("chainId", "txHash", "logIndex");
CREATE INDEX "NftOwnershipHistory_tokenId_createdAt_idx" ON "NftOwnershipHistory"("tokenId", "createdAt");
CREATE INDEX "NftOwnershipHistory_toUserId_createdAt_idx" ON "NftOwnershipHistory"("toUserId", "createdAt");

ALTER TABLE "NftOwnershipHistory" ADD CONSTRAINT "NftOwnershipHistory_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NftOwnershipHistory" ADD CONSTRAINT "NftOwnershipHistory_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NftBurnHistory" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "tokenId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "buyerWallet" TEXT NOT NULL,
    "previousOwnerWallet" TEXT NOT NULL,
    "salePriceUsdt" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftBurnHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NftBurnHistory_chainId_txHash_logIndex_key" ON "NftBurnHistory"("chainId", "txHash", "logIndex");
CREATE INDEX "NftBurnHistory_tokenId_idx" ON "NftBurnHistory"("tokenId");
CREATE INDEX "NftBurnHistory_buyerUserId_idx" ON "NftBurnHistory"("buyerUserId");

ALTER TABLE "NftBurnHistory" ADD CONSTRAINT "NftBurnHistory_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NftSplitHistory" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "parentTokenId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "buyerWallet" TEXT NOT NULL,
    "childTokenIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftSplitHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NftSplitHistory_chainId_txHash_key" ON "NftSplitHistory"("chainId", "txHash");
CREATE INDEX "NftSplitHistory_parentTokenId_idx" ON "NftSplitHistory"("parentTokenId");
CREATE INDEX "NftSplitHistory_buyerUserId_idx" ON "NftSplitHistory"("buyerUserId");

ALTER TABLE "NftSplitHistory" ADD CONSTRAINT "NftSplitHistory_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
