-- Add dedicated one-time marker for the "morning of return due" reminder.
ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "returnReminderMorningSentAt" TIMESTAMP(3);
