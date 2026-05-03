-- Add rejection reason storage for lister approval request rejections
ALTER TABLE "AvailabilityRequest"
ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
