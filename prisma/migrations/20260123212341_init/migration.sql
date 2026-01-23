/*
  Warnings:

  - The values [DEBIT,CREDIT,LOCKED] on the enum `WalletTransactionStatus` will be removed. If these variants are still used in the database, this will fail.
  - The `status` column on the `VirtualAccount` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `prefix` to the `VirtualAccount` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VirtualAccountStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED');

-- AlterEnum
BEGIN;
CREATE TYPE "WalletTransactionStatus_new" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
ALTER TABLE "public"."WalletTransaction" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "WalletTransaction" ALTER COLUMN "status" TYPE "WalletTransactionStatus_new" USING ("status"::text::"WalletTransactionStatus_new");
ALTER TYPE "WalletTransactionStatus" RENAME TO "WalletTransactionStatus_old";
ALTER TYPE "WalletTransactionStatus_new" RENAME TO "WalletTransactionStatus";
DROP TYPE "public"."WalletTransactionStatus_old";
ALTER TABLE "WalletTransaction" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "virtualAccountId" TEXT;

-- AlterTable
ALTER TABLE "VirtualAccount" ADD COLUMN     "prefix" TEXT NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "VirtualAccountStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "WalletTransaction" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
