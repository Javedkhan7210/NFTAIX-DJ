-- CreateTable
CREATE TABLE "MarketNftListing" (
    "id" TEXT NOT NULL,
    "tokenNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "priceUsdt" DECIMAL(18,2) NOT NULL,
    "imageFile" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketNftListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketNftListing_tokenNumber_key" ON "MarketNftListing"("tokenNumber");
