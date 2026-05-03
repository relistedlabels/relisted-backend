-- CreateTable
CREATE TABLE "Closet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Closet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Closet_slug_key" ON "Closet"("slug");

-- CreateIndex
CREATE INDEX "Closet_ownerId_idx" ON "Closet"("ownerId");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "closetId" TEXT;

-- CreateIndex
CREATE INDEX "Product_closetId_idx" ON "Product"("closetId");

-- AddForeignKey
ALTER TABLE "Closet" ADD CONSTRAINT "Closet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_closetId_fkey" FOREIGN KEY ("closetId") REFERENCES "Closet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
