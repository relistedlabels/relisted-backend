-- Align listerCondition with schema.prisma (ItemCondition enum).
-- Prod was created as TEXT in 20260419000000; itemCondition already uses "ItemCondition".
-- Safe cast: existing values must be GOOD, FAIR, POOR, or NULL.

ALTER TABLE "ReturnRequest"
  ALTER COLUMN "listerCondition" TYPE "ItemCondition"
  USING "listerCondition"::"ItemCondition";
