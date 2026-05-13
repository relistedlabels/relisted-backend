-- CreateTable
CREATE TABLE "VaultClosetSaleInterest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultClosetSaleInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultClosetSaleInterest_email_key" ON "VaultClosetSaleInterest"("email");

-- CreateIndex
CREATE INDEX "VaultClosetSaleInterest_userId_idx" ON "VaultClosetSaleInterest"("userId");

-- AddForeignKey
ALTER TABLE "VaultClosetSaleInterest" ADD CONSTRAINT "VaultClosetSaleInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
