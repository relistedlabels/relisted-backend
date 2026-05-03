-- Migration: Remove deprecated listerId column from Order table
-- This migration removes the deprecated listerId column since we now use listerIds (array)

-- Drop the deprecated listerId column
ALTER TABLE "Order" DROP COLUMN IF EXISTS "listerId";
