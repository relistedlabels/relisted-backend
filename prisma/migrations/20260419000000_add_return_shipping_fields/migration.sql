-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN "shippedAt" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "listerCondition" TEXT,
ADD COLUMN "listerDamageNotes" TEXT,
ADD COLUMN "listerConfirmationImages" TEXT[] DEFAULT '{}',
ALTER COLUMN "status" SET DEFAULT 'PENDING_PICKUP';
