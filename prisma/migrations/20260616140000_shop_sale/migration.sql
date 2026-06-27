-- CreateTable
CREATE TABLE "ShopSale" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "subheadline" TEXT,
    "shopTitle" TEXT NOT NULL,
    "shopDescription" TEXT,
    "preSaleMessage" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "earliestDeliveryAt" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bannerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "waitlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "shopAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "showCountdown" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmailSubject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSaleProduct" (
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSaleProduct_pkey" PRIMARY KEY ("saleId","productId")
);

-- CreateTable
CREATE TABLE "ShopSaleInterest" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSaleInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSale_slug_key" ON "ShopSale"("slug");

-- CreateIndex
CREATE INDEX "ShopSale_isEnabled_idx" ON "ShopSale"("isEnabled");

-- CreateIndex
CREATE INDEX "ShopSale_startsAt_endsAt_idx" ON "ShopSale"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ShopSaleProduct_productId_idx" ON "ShopSaleProduct"("productId");

-- CreateIndex
CREATE INDEX "ShopSaleInterest_userId_idx" ON "ShopSaleInterest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSaleInterest_saleId_email_key" ON "ShopSaleInterest"("saleId", "email");

-- AddForeignKey
ALTER TABLE "ShopSaleProduct" ADD CONSTRAINT "ShopSaleProduct_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ShopSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSaleProduct" ADD CONSTRAINT "ShopSaleProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSaleInterest" ADD CONSTRAINT "ShopSaleInterest_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ShopSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSaleInterest" ADD CONSTRAINT "ShopSaleInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
