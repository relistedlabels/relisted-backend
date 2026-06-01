-- Multi-lister returns: one ReturnRequest per RETURN shipment, not per order.
-- Production may still have ReturnRequest_orderId_key if 20260426123000 was skipped.

DROP INDEX IF EXISTS "ReturnRequest_orderId_key";

ALTER TABLE "ReturnRequest" DROP CONSTRAINT IF EXISTS "ReturnRequest_orderId_key";

-- At most one return request per RETURN leg (nullable for legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS "ReturnRequest_shipmentId_key"
ON "ReturnRequest" ("shipmentId")
WHERE "shipmentId" IS NOT NULL;

-- Non-unique lookup index (replaces the old unique index for order-scoped queries).
CREATE INDEX IF NOT EXISTS "ReturnRequest_orderId_idx"
ON "ReturnRequest" ("orderId");
