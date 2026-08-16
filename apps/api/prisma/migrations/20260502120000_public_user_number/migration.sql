-- Add nullable column first for backfill
ALTER TABLE "User" ADD COLUMN "publicUserNumber" INTEGER;

-- Assign sequential public IDs by account creation time
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) AS rn
  FROM "User"
)
UPDATE "User" u
SET "publicUserNumber" = n.rn
FROM numbered n
WHERE u.id = n.id;

-- Sequence for new rows (continues after max existing)
-- setval(x, 0) fails; empty User table must use setval(seq, 1, false) so the first nextval() returns 1
CREATE SEQUENCE "User_publicUserNumber_seq";
SELECT setval(
  '"User_publicUserNumber_seq"',
  CASE WHEN (SELECT COUNT(*)::bigint FROM "User") = 0 THEN 1 ELSE (SELECT MAX("publicUserNumber") FROM "User") END,
  (SELECT COUNT(*)::bigint FROM "User") > 0
);
ALTER TABLE "User" ALTER COLUMN "publicUserNumber" SET DEFAULT nextval('"User_publicUserNumber_seq"');
ALTER SEQUENCE "User_publicUserNumber_seq" OWNED BY "User"."publicUserNumber";

ALTER TABLE "User" ALTER COLUMN "publicUserNumber" SET NOT NULL;

CREATE UNIQUE INDEX "User_publicUserNumber_key" ON "User"("publicUserNumber");
