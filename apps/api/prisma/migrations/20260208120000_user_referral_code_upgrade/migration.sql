-- Upgrade legacy databases (e.g. created before referralCode) to match current Prisma schema.

-- Wallet / optional password accounts
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- referralCode: add, backfill, constrain
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;

UPDATE "User" u
SET "referralCode" = 'U' || upper(substr(md5(random()::text || u.id || clock_timestamp()::text), 1, 9))
WHERE u."referralCode" IS NULL OR trim(u."referralCode") = '';

ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;

DROP INDEX IF EXISTS "User_referralCode_key";
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
