-- Phase 1: Add new fields for multi-lister support
-- Add listerIds array to Order model
ALTER TABLE "Order" ADD COLUMN "listerIds" TEXT[];

-- Change Order.escrows from one-to-one to one-to-many (already handled by schema change)
-- No SQL needed for relation change

-- Add listerId to Shipment model
ALTER TABLE "Shipment" ADD COLUMN "listerId" TEXT;

-- Add listerId to Escrow model
ALTER TABLE "Escrow" ADD COLUMN "listerId" TEXT NOT NULL DEFAULT '';

-- Move shipmentId field in ReturnRequest (already exists, just need to ensure it's nullable)
-- No change needed - shipmentId already exists and is nullable
