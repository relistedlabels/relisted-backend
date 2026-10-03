-- Admin alert dedupe: one in-app + email ping per Lagos calendar day when a RETURN leg is past due with no return request.
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "adminReturnRequestPastDueLastNotifiedAt" TIMESTAMP(3);
