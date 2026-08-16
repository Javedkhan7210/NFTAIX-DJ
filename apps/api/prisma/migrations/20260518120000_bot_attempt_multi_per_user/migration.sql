-- Allow multiple purchase attempts per user in one admin manual run
DROP INDEX IF EXISTS "BotPurchaseAttempt_runId_userId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "BotPurchaseAttempt_runId_sortOrder_key" ON "BotPurchaseAttempt"("runId", "sortOrder");
