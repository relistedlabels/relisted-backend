/*
  Warnings:

  - The values [RESELOVE] on the enum `DisputeStatus` will be removed. If these variants are still used in the database, this will fail.
  - The `status` column on the `Transaction` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('LOCKED', 'RELEASED', 'PARTIALLY_RELEASED', 'REFUNDED');

-- AlterEnum
BEGIN;
CREATE TYPE "DisputeStatus_new" AS ENUM ('IN_REVIEW', 'PENDING', 'WITHDRAW', 'RESELOVED', 'REJECTED');
ALTER TABLE "public"."Dispute" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Dispute" ALTER COLUMN "status" TYPE "DisputeStatus_new" USING ("status"::text::"DisputeStatus_new");
ALTER TYPE "DisputeStatus" RENAME TO "DisputeStatus_old";
ALTER TYPE "DisputeStatus_new" RENAME TO "DisputeStatus";
DROP TYPE "public"."DisputeStatus_old";
ALTER TABLE "Dispute" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "status",
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING';

-- DropEnum
DROP TYPE "SubOrderStatus";

-- CreateTable
CREATE TABLE "Escrow" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "renterId" TEXT NOT NULL,
    "curatorId" TEXT NOT NULL,
    "rentalAmount" INTEGER NOT NULL,
    "collateralAmount" INTEGER NOT NULL,
    "cleaningFee" INTEGER NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'LOCKED',
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualAccount" (
    "id" TEXT NOT NULL,
    "vaNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_orderId_key" ON "Escrow"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualAccount_vaNumber_key" ON "VirtualAccount"("vaNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualAccount_orderId_key" ON "VirtualAccount"("orderId");

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccount" ADD CONSTRAINT "VirtualAccount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccount" ADD CONSTRAINT "VirtualAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
