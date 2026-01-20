/*
  Warnings:

  - Changed the type of `originalValue` on the `Product` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "originalValue",
ADD COLUMN     "originalValue" INTEGER NOT NULL;
