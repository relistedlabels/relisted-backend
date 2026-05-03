-- Data Migration Script: Backfill new fields for existing data
-- This should be run AFTER the schema migration is applied

-- Step 1: Backfill Order.listerIds from existing order items
-- For each order, collect unique lister IDs from its order items
UPDATE "Order" o
SET "listerIds" = (
  SELECT ARRAY_AGG(DISTINCT p."curatorId")
  FROM "OrderItem" oi
  JOIN "Product" p ON oi."productId" = p.id
  WHERE oi."orderId" = o.id
)
WHERE "listerIds" IS NULL;

-- Step 2: Backfill Shipment.listerId from order items
-- For each shipment, get the listerId from the associated order's items
-- Since shipments are per-lister, we can derive this from the order's listerIds
-- For now, we'll use the first listerId from the order's listerIds array
UPDATE "Shipment" s
SET "listerId" = (
  SELECT o."listerIds"[1]
  FROM "Order" o
  WHERE o.id = s."orderId"
)
WHERE s."listerId" IS NULL OR s."listerId" = '';

-- Step 3: Backfill Escrow.listerId from Order.listerIds
-- For existing single-lister orders, copy the first listerId from the order's listerIds array
UPDATE "Escrow" e
SET "listerId" = (
  SELECT o."listerIds"[1]
  FROM "Order" o
  WHERE o.id = e."orderId"
)
WHERE e."listerId" = '';

-- Step 4: Verify the backfill
-- Check for any orders without listerIds
SELECT id, "orderId" FROM "Order" WHERE "listerIds" IS NULL OR array_length("listerIds", 1) = 0;

-- Check for any shipments without listerId
SELECT id, "orderId" FROM "Shipment" WHERE "listerId" IS NULL OR "listerId" = '';

-- Check for any escrows without listerId
SELECT id, "orderId" FROM "Escrow" WHERE "listerId" = '';
