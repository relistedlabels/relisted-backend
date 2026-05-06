-- Link order lines to checkout shipment legs (multi-schedule / multi-lister support)

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "outboundShipmentId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "returnShipmentId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "resaleShipmentId" TEXT;

ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_outboundShipmentId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_returnShipmentId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_resaleShipmentId_fkey";

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_outboundShipmentId_fkey" FOREIGN KEY ("outboundShipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_returnShipmentId_fkey" FOREIGN KEY ("returnShipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_resaleShipmentId_fkey" FOREIGN KEY ("resaleShipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
