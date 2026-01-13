/*
  Warnings:

  - Added the required column `purpose` to the `Upload` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "purpose" TEXT NOT NULL;
