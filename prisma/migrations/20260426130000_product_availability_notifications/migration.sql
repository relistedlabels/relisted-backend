-- Subscriptions for notify-when-available on products

CREATE TABLE "ProductAvailabilityNotification" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAvailabilityNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductAvailabilityNotification_productId_userId_key" ON "ProductAvailabilityNotification"("productId", "userId");

CREATE INDEX "ProductAvailabilityNotification_productId_idx" ON "ProductAvailabilityNotification"("productId");

ALTER TABLE "ProductAvailabilityNotification" ADD CONSTRAINT "ProductAvailabilityNotification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductAvailabilityNotification" ADD CONSTRAINT "ProductAvailabilityNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
