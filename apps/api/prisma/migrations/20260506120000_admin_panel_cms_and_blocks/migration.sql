-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;

-- AlterTable
ALTER TABLE "WalletConnection" ADD COLUMN IF NOT EXISTS "blocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SiteContent" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SiteContent" ("id", "payload", "updatedAt")
VALUES (
  'default',
  '{"banners":[],"slides":[],"promos":[],"comingSoon":{"enabled":false,"title":"","items":[]},"socialLinks":{"telegramUrl":"","whatsAppUrl":""},"notifications":[]}'::jsonb,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
