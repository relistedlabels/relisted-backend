-- Add isSuspended field to User table
-- This field allows admins to suspend/unsuspend users
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT false;
