-- Add reminder tracking fields
ALTER TABLE "Order" ADD COLUMN "returnRequestReminderSentAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "returnRequestPastDueSentAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN "reminder24hSentAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN "reminderDayOfSentAt" TIMESTAMP(3);
