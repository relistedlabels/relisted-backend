ALTER TABLE "Shipment"
  ADD COLUMN "scheduledWindowStart" TIMESTAMP(3),
  ADD COLUMN "scheduledWindowEnd" TIMESTAMP(3);

UPDATE "Shipment"
SET
  "scheduledWindowStart" = "scheduledDate",
  "scheduledWindowEnd" = "scheduledDate" + INTERVAL '2 hours'
WHERE "scheduledWindowStart" IS NULL;
