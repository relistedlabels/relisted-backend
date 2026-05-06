-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "listerReturnWindowPassedNotifiedAt" TIMESTAMP(3);
