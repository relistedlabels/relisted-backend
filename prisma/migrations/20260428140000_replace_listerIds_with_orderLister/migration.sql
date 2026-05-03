-- Migration: Replace Order.listerIds array with OrderLister junction table
-- Step 1: Create OrderLister table
CREATE TABLE "OrderLister" (
  "orderId" TEXT NOT NULL,
  "listerId" TEXT NOT NULL,
  PRIMARY KEY ("orderId", "listerId"),
  CONSTRAINT "OrderLister_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderLister_listerId_fkey" FOREIGN KEY ("listerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 2: Backfill OrderLister from existing listerIds array
-- For each order, expand the listerIds array and create OrderLister records
INSERT INTO "OrderLister" ("orderId", "listerId")
SELECT 
  o.id as "orderId",
  unnest(o."listerIds") as "listerId"
FROM "Order" o
WHERE o."listerIds" IS NOT NULL AND array_length(o."listerIds", 1) > 0
ON CONFLICT ("orderId", "listerId") DO NOTHING;

-- Step 3: Drop the listerIds column from Order
ALTER TABLE "Order" DROP COLUMN IF EXISTS "listerIds";
