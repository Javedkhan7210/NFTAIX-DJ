-- CreateEnum
CREATE TYPE "CustodyDepositStatus" AS ENUM ('pending', 'confirmed', 'credited');

-- CreateTable
CREATE TABLE "CustodialWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "encryptionIv" TEXT NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustodialWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainSyncState" (
    "chain" TEXT NOT NULL,
    "lastScannedBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainSyncState_pkey" PRIMARY KEY ("chain")
);

-- CreateTable
CREATE TABLE "UsdtDeposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "status" "CustodyDepositStatus" NOT NULL DEFAULT 'pending',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "creditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsdtDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "available" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "locked" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustodialWallet_userId_key" ON "CustodialWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustodialWallet_address_key" ON "CustodialWallet"("address");

-- CreateIndex
CREATE INDEX "CustodialWallet_chain_idx" ON "CustodialWallet"("chain");

-- CreateIndex
CREATE INDEX "UsdtDeposit_userId_idx" ON "UsdtDeposit"("userId");

-- CreateIndex
CREATE INDEX "UsdtDeposit_status_idx" ON "UsdtDeposit"("status");

-- CreateIndex
CREATE INDEX "UsdtDeposit_toAddress_idx" ON "UsdtDeposit"("toAddress");

-- CreateIndex
CREATE UNIQUE INDEX "UsdtDeposit_txHash_logIndex_key" ON "UsdtDeposit"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "AccountBalance_userId_idx" ON "AccountBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBalance_userId_asset_key" ON "AccountBalance"("userId", "asset");

-- AddForeignKey
ALTER TABLE "CustodialWallet" ADD CONSTRAINT "CustodialWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsdtDeposit" ADD CONSTRAINT "UsdtDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBalance" ADD CONSTRAINT "AccountBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
