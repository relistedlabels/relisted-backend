-- Admin reminder dedupe for manual Relisted dispatch legs (due soon).
ALTER TABLE "Shipment" ADD COLUMN "manualDueReminder24hSentAt" TIMESTAMP(3),
ADD COLUMN "manualDueReminderMorningSentAt" TIMESTAMP(3);
