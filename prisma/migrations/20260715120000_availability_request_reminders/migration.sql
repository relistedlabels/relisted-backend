-- Automated reminders for approved (checkout) and expired (lister) availability requests
ALTER TABLE "AvailabilityRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "AvailabilityRequest" ADD COLUMN IF NOT EXISTS "reminderState" JSONB;
