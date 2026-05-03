-- Add Topship rate fields to Shipment to persist the rate selected at checkout
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pricingTier" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "shipmentCharge" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pickupCharge" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "vatCharge" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pickupPartner" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pickupId" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "deliveryLocation" TEXT;
