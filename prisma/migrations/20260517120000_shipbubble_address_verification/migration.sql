-- CreateTable
CREATE TABLE "ShipbubbleAddressVerification" (
    "id" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "addressCode" INTEGER NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "normalizedAddressLine" TEXT NOT NULL,
    "formattedAddress" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "profileId" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipbubbleAddressVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipbubbleAddressVerification_addressHash_key" ON "ShipbubbleAddressVerification"("addressHash");

-- CreateIndex
CREATE INDEX "ShipbubbleAddressVerification_profileId_idx" ON "ShipbubbleAddressVerification"("profileId");

-- AddForeignKey
ALTER TABLE "ShipbubbleAddressVerification" ADD CONSTRAINT "ShipbubbleAddressVerification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
