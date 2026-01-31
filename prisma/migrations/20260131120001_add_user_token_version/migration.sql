-- Add tokenVersion to User (no new table; invalidate tokens on logout by bumping version)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Remove BlacklistedToken table if it was created by a previous migration
DROP TABLE IF EXISTS "BlacklistedToken";
