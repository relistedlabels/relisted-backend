-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "reconciledAsManualAt" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN "actualFulfillmentCostKobo" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN "adminReconcileNote" TEXT;
