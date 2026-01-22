/*
  Warnings:

  - A unique constraint covering the columns `[disputeId]` on the table `Dispute` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `disputeId` to the `Dispute` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "DisputeStatus" ADD VALUE 'WITHDRAW';

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "disputeId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_disputeId_key" ON "Dispute"("disputeId");
