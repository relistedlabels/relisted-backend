/*
  Warnings:

  - You are about to drop the column `size` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "size",
ALTER COLUMN "color" SET NOT NULL,
ALTER COLUMN "color" SET DATA TYPE TEXT,
ALTER COLUMN "careSteps" SET NOT NULL,
ALTER COLUMN "careSteps" SET DATA TYPE TEXT;
