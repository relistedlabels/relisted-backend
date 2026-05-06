-- Persist admin-written outcome text for dispute resolved emails and history.
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "resolutionDetails" TEXT;
