-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "returnShipmentId" TEXT,
ADD COLUMN "returnTrackingId" TEXT,
ADD COLUMN "returnShippingTier" TEXT,
ADD COLUMN "returnShippingFee" INTEGER,
ADD COLUMN "returnPickupPartner" TEXT;
