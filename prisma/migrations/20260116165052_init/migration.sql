/*
  Warnings:

  - A unique constraint covering the columns `[disputeId]` on the table `Attachments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Attachments" ADD COLUMN     "disputeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Attachments_disputeId_key" ON "Attachments"("disputeId");

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
