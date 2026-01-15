/*
  Warnings:

  - You are about to drop the column `profileId` on the `Attachments` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[avatarUploadId]` on the table `Profile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[ninUploadId]` on the table `Profile` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Attachments" DROP CONSTRAINT "Attachments_profileId_fkey";

-- DropIndex
DROP INDEX "Attachments_profileId_key";

-- AlterTable
ALTER TABLE "Attachments" DROP COLUMN "profileId";

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "avatarUploadId" TEXT,
ADD COLUMN     "ninUploadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Profile_avatarUploadId_key" ON "Profile"("avatarUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_ninUploadId_key" ON "Profile"("ninUploadId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_avatarUploadId_fkey" FOREIGN KEY ("avatarUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_ninUploadId_fkey" FOREIGN KEY ("ninUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
