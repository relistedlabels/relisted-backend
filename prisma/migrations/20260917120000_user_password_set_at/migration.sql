-- Track whether the user chose a password (null = magic-link / OAuth only).
ALTER TABLE "User" ADD COLUMN "passwordSetAt" TIMESTAMP(3);

UPDATE "User"
SET "passwordSetAt" = "createdAt"
WHERE "passwordSetAt" IS NULL
  AND ("provider" IS NULL OR "provider" NOT IN ('guest', 'google'))
  AND "password" <> '';
