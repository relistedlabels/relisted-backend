-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('RENTAL', 'RESALE', 'RENT_OR_RESALE');

-- AlterEnum
ALTER TYPE "AvailabilityStatus" ADD VALUE 'ORDERED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "listingType" "ListingType" NOT NULL DEFAULT 'RENTAL';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "listingType" "ListingType" NOT NULL DEFAULT 'RENTAL',
ADD COLUMN "rentalCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "resalePrice" INTEGER;

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN "resaleAmount" INTEGER;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "dailyPrice" DROP NOT NULL;

-- Backfill listerId for orders where all items belong to the same lister.
-- Orders with items from multiple listers will keep NULL listerId.
UPDATE "Order" o
SET "listerId" = (
  SELECT p."curatorId"
  FROM "OrderItem" oi
  JOIN "Product" p ON oi."productId" = p.id
  WHERE oi."orderId" = o.id
  ORDER BY oi.id ASC
  LIMIT 1
)
WHERE o."listerId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "OrderItem" oi
    JOIN "Product" p ON oi."productId" = p.id
    WHERE oi."orderId" = o.id
    GROUP BY p."curatorId"
    HAVING COUNT(DISTINCT p."curatorId") = 1
  );