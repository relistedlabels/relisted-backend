/*
  Warnings:

  - You are about to drop the column `purpose` on the `Upload` table. All the data in the column will be lost.
  - Added the required column `fieldName` to the `Upload` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Upload" DROP COLUMN "purpose",
ADD COLUMN     "fieldName" TEXT NOT NULL;
