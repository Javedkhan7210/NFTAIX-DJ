-- CreateEnum
CREATE TYPE "BotPurchaseRunStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "BotPurchaseAttemptStatus" AS ENUM ('success', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "BotPurchaseRun" (
    "id" TEXT NOT NULL,
    "status" "BotPurchaseRunStatus" NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "BotPurchaseRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotPurchaseAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "walletAddress" TEXT,
    "targetRemainingUsdt" DECIMAL(18,2) NOT NULL,
    "balanceUsdt" DECIMAL(18,2) NOT NULL,
    "budgetUsdt" DECIMAL(18,2) NOT NULL,
    "tokenId" TEXT,
    "effectivePayUsdt" DECIMAL(18,6),
    "status" "BotPurchaseAttemptStatus" NOT NULL,
    "failureReason" TEXT,
    "chainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotPurchaseAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotPurchaseRun_startedAt_idx" ON "BotPurchaseRun"("startedAt");

-- CreateIndex
CREATE INDEX "BotPurchaseAttempt_runId_sortOrder_idx" ON "BotPurchaseAttempt"("runId", "sortOrder");

-- CreateIndex
CREATE INDEX "BotPurchaseAttempt_userId_idx" ON "BotPurchaseAttempt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BotPurchaseAttempt_runId_userId_key" ON "BotPurchaseAttempt"("runId", "userId");

-- AddForeignKey
ALTER TABLE "BotPurchaseAttempt" ADD CONSTRAINT "BotPurchaseAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BotPurchaseRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotPurchaseAttempt" ADD CONSTRAINT "BotPurchaseAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
