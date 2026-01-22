/*
  Warnings:

  - You are about to drop the column `reservedUntil` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "reservedUntil";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "status";
