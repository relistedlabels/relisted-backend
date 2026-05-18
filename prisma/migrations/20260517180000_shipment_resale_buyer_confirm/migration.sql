-- Per-shipment resale buyer confirmation and partial resale escrow tracking
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "buyerConfirmedAt" TIMESTAMP(3);

ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "resaleReleasedAmount" INTEGER NOT NULL DEFAULT 0;
