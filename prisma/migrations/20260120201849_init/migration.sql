/*
  Warnings:

  - You are about to drop the `SubOrder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_subOrderId_fkey";

-- DropForeignKey
ALTER TABLE "SubOrder" DROP CONSTRAINT "SubOrder_curatorId_fkey";

-- DropForeignKey
ALTER TABLE "SubOrder" DROP CONSTRAINT "SubOrder_orderId_fkey";

-- DropTable
DROP TABLE "SubOrder";
