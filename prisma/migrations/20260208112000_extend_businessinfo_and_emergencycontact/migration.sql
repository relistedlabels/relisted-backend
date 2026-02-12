-- Extend BusinessInfo with optional descriptive fields
ALTER TABLE "BusinessInfo" ADD COLUMN IF NOT EXISTS "businessPhone" TEXT;
ALTER TABLE "BusinessInfo" ADD COLUMN IF NOT EXISTS "businessDescription" TEXT;
ALTER TABLE "BusinessInfo" ADD COLUMN IF NOT EXISTS "businessCategory" TEXT;
ALTER TABLE "BusinessInfo" ADD COLUMN IF NOT EXISTS "website" TEXT;

-- Add optional email to EmergencyContact
ALTER TABLE "EmergencyContact" ADD COLUMN IF NOT EXISTS "email" TEXT;

