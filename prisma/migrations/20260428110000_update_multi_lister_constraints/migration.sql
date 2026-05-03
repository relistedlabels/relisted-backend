-- Phase 2: Constraint Changes for multi-lister support
-- This migration should be run AFTER the data migration script has been executed

-- Step 1: Remove unique constraint from Escrow.orderId
-- First, drop the existing unique constraint on orderId
ALTER TABLE "Escrow" DROP CONSTRAINT IF EXISTS "Escrow_orderId_key";

-- Step 2: Add composite unique constraint on Escrow(orderId, listerId)
-- This allows one escrow per lister per order
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_orderId_listerId_key" UNIQUE ("orderId", "listerId");

-- Step 3: Remove unique constraint from ReturnRequest.orderId
-- This allows multiple return requests per order (one per shipment)
ALTER TABLE "ReturnRequest" DROP CONSTRAINT IF EXISTS "ReturnRequest_orderId_key";

-- Note: We're not adding a new unique constraint to ReturnRequest
-- because we want to allow multiple returns per order (one per shipment)
-- The combination of orderId + shipmentId will naturally be unique in practice
