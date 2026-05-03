-- Shipment, dispatch logs, multi-lister (+ backfills), Topship rate fields, dispatch/request windows, rejection reason.

-- Shipment + dispatch attempt log (enum includes RESALE)
CREATE TYPE "ShipmentType" AS ENUM ('OUTBOUND', 'RETURN', 'RESALE');

CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'DISPATCHING', 'DISPATCH_FAILED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "ShipmentType" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "pickupAddress" JSONB NOT NULL,
    "deliveryAddress" JSONB NOT NULL,
    "providerShipmentId" TEXT,
    "providerTrackingUrl" TEXT,
    "trackingId" TEXT,
    "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DispatchAttemptLog" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "DispatchAttemptLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Shipment_scheduledDate_status_idx" ON "Shipment"("scheduledDate", "status");

CREATE INDEX "Shipment_scheduledDate_pending_idx" ON "Shipment"("scheduledDate") WHERE "status" = 'PENDING';

CREATE INDEX "DispatchAttemptLog_shipmentId_idx" ON "DispatchAttemptLog"("shipmentId");

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispatchAttemptLog" ADD CONSTRAINT "DispatchAttemptLog_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Multi-lister: new columns, then backfill listerIds / shipment & escrow listerId from product curatorId (via order lines)
ALTER TABLE "Order" ADD COLUMN "listerIds" TEXT[];

ALTER TABLE "Shipment" ADD COLUMN "listerId" TEXT;

ALTER TABLE "Escrow" ADD COLUMN "listerId" TEXT NOT NULL DEFAULT '';

UPDATE "Order" o
SET "listerIds" = (
  SELECT ARRAY_AGG(DISTINCT p."curatorId")
  FROM "OrderItem" oi
  JOIN "Product" p ON oi."productId" = p.id
  WHERE oi."orderId" = o.id
)
WHERE "listerIds" IS NULL;

UPDATE "Shipment" s
SET "listerId" = (
  SELECT o."listerIds"[1]
  FROM "Order" o
  WHERE o.id = s."orderId"
)
WHERE s."listerId" IS NULL OR s."listerId" = '';

UPDATE "Escrow" e
SET "listerId" = (
  SELECT o."listerIds"[1]
  FROM "Order" o
  WHERE o.id = e."orderId"
)
WHERE e."listerId" = '';

-- Multi-lister constraints (escrow per lister; multiple return requests per order)
ALTER TABLE "Escrow" DROP CONSTRAINT IF EXISTS "Escrow_orderId_key";

ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_orderId_listerId_key" UNIQUE ("orderId", "listerId");

ALTER TABLE "ReturnRequest" DROP CONSTRAINT IF EXISTS "ReturnRequest_orderId_key";

-- Drop legacy single-lister column on Order
ALTER TABLE "Order" DROP COLUMN IF EXISTS "listerId";

-- Escrow: copy listerId from curatorId where still empty, then drop curatorId
UPDATE "Escrow"
SET "listerId" = "curatorId"
WHERE ("listerId" = '' OR "listerId" IS NULL) AND "curatorId" IS NOT NULL;

ALTER TABLE "Escrow" ALTER COLUMN "listerId" SET NOT NULL;

ALTER TABLE "Escrow" DROP COLUMN IF EXISTS "curatorId";

-- OrderLister junction (replaces Order.listerIds array)
CREATE TABLE "OrderLister" (
  "orderId" TEXT NOT NULL,
  "listerId" TEXT NOT NULL,
  PRIMARY KEY ("orderId", "listerId"),
  CONSTRAINT "OrderLister_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderLister_listerId_fkey" FOREIGN KEY ("listerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "OrderLister" ("orderId", "listerId")
SELECT
  o.id as "orderId",
  unnest(o."listerIds") as "listerId"
FROM "Order" o
WHERE o."listerIds" IS NOT NULL AND array_length(o."listerIds", 1) > 0
ON CONFLICT ("orderId", "listerId") DO NOTHING;

ALTER TABLE "Order" DROP COLUMN IF EXISTS "listerIds";

-- Shipment Topship rate snapshot fields
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pricingTier" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "shipmentCharge" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pickupCharge" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "vatCharge" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pickupPartner" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "pickupId" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "deliveryLocation" TEXT;

-- Shipment scheduled window columns + backfill from scheduledDate
ALTER TABLE "Shipment"
  ADD COLUMN "scheduledWindowStart" TIMESTAMP(3),
  ADD COLUMN "scheduledWindowEnd" TIMESTAMP(3);

UPDATE "Shipment"
SET
  "scheduledWindowStart" = "scheduledDate",
  "scheduledWindowEnd" = "scheduledDate" + INTERVAL '2 hours'
WHERE "scheduledWindowStart" IS NULL;

-- Availability / return pickup windows on requests
ALTER TABLE "AvailabilityRequest"
  ADD COLUMN IF NOT EXISTS "outboundWindowStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "outboundWindowEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnWindowStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnWindowEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resaleWindowStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resaleWindowEnd" TIMESTAMP(3);

ALTER TABLE "ReturnRequest"
  ADD COLUMN IF NOT EXISTS "pickupWindowStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pickupWindowEnd" TIMESTAMP(3);

-- Lister rejection reason on availability requests
ALTER TABLE "AvailabilityRequest"
ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
