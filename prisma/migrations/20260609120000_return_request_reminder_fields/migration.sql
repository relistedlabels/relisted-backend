-- Return-request completion reminder dedupe (per RETURN Shipment leg)
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "returnRequestReminderState" JSONB;
