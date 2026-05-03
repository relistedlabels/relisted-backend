-- Migration: Remove curatorId from Escrow and add unique constraint
-- Step 1: Backfill listerId from curatorId for existing records
-- Note: listerId was added as NOT NULL DEFAULT '', so check for empty string
UPDATE "Escrow"
SET "listerId" = "curatorId"
WHERE ("listerId" = '' OR "listerId" IS NULL) AND "curatorId" IS NOT NULL;

-- Step 2: Make listerId NOT NULL (after backfilling)
ALTER TABLE "Escrow" ALTER COLUMN "listerId" SET NOT NULL;

-- Step 3: Drop the curatorId column
ALTER TABLE "Escrow" DROP COLUMN IF EXISTS "curatorId";

-- Step 4: Add unique constraint on orderId and listerId
-- Note: This may fail if there are duplicate (orderId, listerId) combinations
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_orderId_listerId_key" UNIQUE ("orderId", "listerId");
