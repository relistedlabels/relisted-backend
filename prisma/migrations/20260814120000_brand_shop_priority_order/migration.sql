-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "shopPriorityOrder" INTEGER;

-- Backfill order for existing prioritized brands (alphabetical)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name ASC) - 1 AS rn
  FROM "Brand"
  WHERE "isShopPrioritized" = true
)
UPDATE "Brand" b
SET "shopPriorityOrder" = ranked.rn
FROM ranked
WHERE b.id = ranked.id;
