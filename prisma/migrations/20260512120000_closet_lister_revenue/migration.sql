-- Snapshot closet + resale lister amount on order lines for payout attribution.
-- Per-closet tracked balance (integer Naira, same unit convention as Wallet).

ALTER TABLE "Closet" ADD COLUMN "closetWalletBalance" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OrderItem" ADD COLUMN "closetId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "resaleListerAmount" INTEGER;

CREATE INDEX "OrderItem_closetId_idx" ON "OrderItem"("closetId");

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_closetId_fkey" FOREIGN KEY ("closetId") REFERENCES "Closet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
