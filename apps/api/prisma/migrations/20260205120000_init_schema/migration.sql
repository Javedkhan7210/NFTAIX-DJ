-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin', 'superadmin');

-- CreateEnum
CREATE TYPE "IncomeStatus" AS ENUM ('locked', 'unlocked', 'burned');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('direct', 'network', 'level', 'team', 'global_pool', 'nft', 'other');

-- CreateEnum
CREATE TYPE "TradingComplianceStatus" AS ENUM ('compliant', 'non_compliant', 'inactive');

-- CreateEnum
CREATE TYPE "GlobalRank" AS ENUM ('prime_member', 'elite_builder', 'royal_leader', 'global_director', 'crown_ambassador');

-- CreateEnum
CREATE TYPE "GlobalPoolRunStatus" AS ENUM ('pending', 'distributing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "referralCode" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "sponsorId" TEXT,
    "directReferralCount" INTEGER NOT NULL DEFAULT 0,
    "teamCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inactiveSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSignatureAt" TIMESTAMP(3),

    CONSTRAINT "WalletConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletAuthNonce" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletAuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activationAmount" DECIMAL(18,2) NOT NULL,
    "tradingLimit" DECIMAL(18,2) NOT NULL,
    "isBaseEntry" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackageTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageActivation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackageActivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpgradeEligibilityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromTierAmount" DECIMAL(18,2) NOT NULL,
    "toTierAmount" DECIMAL(18,2) NOT NULL,
    "requiredDays" INTEGER NOT NULL,
    "meetsDuration" BOOLEAN NOT NULL,
    "meetsTradingRule" BOOLEAN NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpgradeEligibilityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralEdge" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageActivationId" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "volume" DECIMAL(18,2) NOT NULL,
    "allowedDailyVolume" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTradingCompliance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "requiredVolume" DECIMAL(18,2) NOT NULL,
    "achievedVolume" DECIMAL(18,2) NOT NULL,
    "status" "TradingComplianceStatus" NOT NULL,
    "consecutiveMiss" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyTradingCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceUserId" TEXT,
    "incomeType" "IncomeType" NOT NULL DEFAULT 'other',
    "amount" DECIMAL(18,6) NOT NULL,
    "status" "IncomeStatus" NOT NULL DEFAULT 'locked',
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeLog" (
    "id" TEXT NOT NULL,
    "incomeId" TEXT NOT NULL,
    "fromStatus" "IncomeStatus",
    "toStatus" "IncomeStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenDistributionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activationId" TEXT NOT NULL,
    "directSponsorPct" DECIMAL(5,2) NOT NULL,
    "networkPct" DECIMAL(5,2) NOT NULL,
    "creatorPct" DECIMAL(5,2) NOT NULL,
    "burnPct" DECIMAL(5,2) NOT NULL,
    "liquidityPct" DECIMAL(5,2) NOT NULL,
    "globalPct" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenDistributionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NFTRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "baseValue" DECIMAL(18,6) NOT NULL,
    "currentValue" DECIMAL(18,6) NOT NULL,
    "isBurned" BOOLEAN NOT NULL DEFAULT false,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "burnedAt" TIMESTAMP(3),

    CONSTRAINT "NFTRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankRule" (
    "id" TEXT NOT NULL,
    "rank" "GlobalRank" NOT NULL,
    "minDirectReferrals" INTEGER NOT NULL,
    "minTeamSize" INTEGER NOT NULL,
    "globalPoolSharePct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "RankRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" "GlobalRank" NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalPool" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(18,6) NOT NULL,
    "distributedAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "GlobalPoolRunStatus" NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalPoolDistribution" (
    "id" TEXT NOT NULL,
    "globalPoolId" TEXT NOT NULL,
    "rank" "GlobalRank" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalPoolDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BurnLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "chainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BurnLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "chainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_sponsorId_idx" ON "User"("sponsorId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConnection_walletAddress_key" ON "WalletConnection"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletConnection_userId_idx" ON "WalletConnection"("userId");

-- CreateIndex
CREATE INDEX "WalletAuthNonce_address_idx" ON "WalletAuthNonce"("address");

-- CreateIndex
CREATE INDEX "WalletAuthNonce_expiresAt_idx" ON "WalletAuthNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PackageTier_name_key" ON "PackageTier"("name");

-- CreateIndex
CREATE INDEX "ReferralEdge_sponsorId_idx" ON "ReferralEdge"("sponsorId");

-- CreateIndex
CREATE INDEX "ReferralEdge_referralId_idx" ON "ReferralEdge"("referralId");

-- CreateIndex
CREATE INDEX "ReferralEdge_sponsorId_level_idx" ON "ReferralEdge"("sponsorId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTradingCompliance_userId_day_key" ON "DailyTradingCompliance"("userId", "day");

-- CreateIndex
CREATE INDEX "IncomeLedger_userId_status_idx" ON "IncomeLedger"("userId", "status");

-- CreateIndex
CREATE INDEX "IncomeLedger_lockedUntil_idx" ON "IncomeLedger"("lockedUntil");

-- CreateIndex
CREATE INDEX "IncomeLog_incomeId_idx" ON "IncomeLog"("incomeId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardSetting_key_key" ON "RewardSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "NFTRecord_tokenId_key" ON "NFTRecord"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "RankRule_rank_key" ON "RankRule"("rank");

-- CreateIndex
CREATE INDEX "GlobalPool_day_idx" ON "GlobalPool"("day");

-- CreateIndex
CREATE INDEX "GlobalPool_status_idx" ON "GlobalPool"("status");

-- CreateIndex
CREATE INDEX "GlobalPoolDistribution_globalPoolId_idx" ON "GlobalPoolDistribution"("globalPoolId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConnection" ADD CONSTRAINT "WalletConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageActivation" ADD CONSTRAINT "PackageActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageActivation" ADD CONSTRAINT "PackageActivation_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "PackageTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingLog" ADD CONSTRAINT "TradingLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingLog" ADD CONSTRAINT "TradingLog_packageActivationId_fkey" FOREIGN KEY ("packageActivationId") REFERENCES "PackageActivation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTradingCompliance" ADD CONSTRAINT "DailyTradingCompliance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeLedger" ADD CONSTRAINT "IncomeLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeLog" ADD CONSTRAINT "IncomeLog_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "IncomeLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NFTRecord" ADD CONSTRAINT "NFTRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankHistory" ADD CONSTRAINT "RankHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalPoolDistribution" ADD CONSTRAINT "GlobalPoolDistribution_globalPoolId_fkey" FOREIGN KEY ("globalPoolId") REFERENCES "GlobalPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BurnLog" ADD CONSTRAINT "BurnLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidityLog" ADD CONSTRAINT "LiquidityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

