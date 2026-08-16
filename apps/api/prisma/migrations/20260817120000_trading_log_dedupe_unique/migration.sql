-- Dedupe on-chain trading logs before unique index (idempotent).
DELETE FROM "TradingLog" a
USING "TradingLog" b
WHERE a."createdAt" > b."createdAt"
  AND a."userId" = b."userId"
  AND a."chainTxHash" IS NOT NULL
  AND b."chainTxHash" IS NOT NULL
  AND a."chainTxHash" = b."chainTxHash"
  AND a."relatedTokenId" IS NOT NULL
  AND b."relatedTokenId" IS NOT NULL
  AND a."relatedTokenId" = b."relatedTokenId";

CREATE UNIQUE INDEX IF NOT EXISTS "TradingLog_userId_chainTxHash_relatedTokenId_key"
  ON "TradingLog" ("userId", "chainTxHash", "relatedTokenId");
