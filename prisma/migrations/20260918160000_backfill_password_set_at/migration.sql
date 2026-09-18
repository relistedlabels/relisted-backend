-- Backfill passwordSetAt for pre-existing password accounts missed by the first migration.
UPDATE "User"
SET "passwordSetAt" = "createdAt"
WHERE "passwordSetAt" IS NULL
  AND ("provider" IS NULL OR "provider" NOT IN ('guest', 'google'))
  AND "password" <> '';
