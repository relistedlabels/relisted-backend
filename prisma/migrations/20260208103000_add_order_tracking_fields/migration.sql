-- Add tracking / timeline fields for Order dispatch workflow
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "estimatedDeliveryDate" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "returnDueAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "externalTrackingUrl" TEXT;

