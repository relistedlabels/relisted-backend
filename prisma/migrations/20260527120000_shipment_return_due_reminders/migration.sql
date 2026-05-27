-- Per RETURN leg renter reminder dedupe (multi-lister orders).
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "returnDueReminder24hSentAt" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "returnDueReminderMorningSentAt" TIMESTAMP(3);
