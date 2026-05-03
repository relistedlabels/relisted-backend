import type { PrismaService } from 'src/services/prisma/prisma.service';

/**
 * Releases rental portion of escrows when the outbound leg is considered delivered.
 * Idempotent: only acts on escrows still in LOCKED with rentalAmount > 0.
 * Matches lister manual "delivered" path so carrier-driven ACTIVE does not skip payout.
 */
export async function releaseRentalEscrowOnOutboundDelivery(
  prisma: PrismaService,
  orderInternalId: string,
  orderDisplayId: string,
): Promise<void> {
  const escrows = await prisma.escrow.findMany({
    where: { orderId: orderInternalId },
  });

  for (const escrow of escrows) {
    if (escrow.status !== 'LOCKED' || !(escrow.rentalAmount || 0)) continue;

    const releaseAmount = escrow.rentalAmount;
    const hasResaleAmount = (escrow.resaleAmount || 0) > 0;

    await prisma.$transaction(async (tx) => {
      const listerWallet = await tx.wallet.upsert({
        where: { userId: escrow.listerId },
        create: {
          userId: escrow.listerId,
          mainBalance: releaseAmount,
          availableBalance: releaseAmount,
        },
        update: {
          mainBalance: { increment: releaseAmount },
          availableBalance: { increment: releaseAmount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: listerWallet.id,
          amount: releaseAmount,
          type: 'MAIN',
          status: 'SUCCESS',
          note: hasResaleAmount
            ? `Rental payment released for order ${orderDisplayId} (resale amount pending buyer confirmation)`
            : `Escrow release for order ${orderDisplayId}`,
          orderId: orderInternalId,
        },
      });

      await tx.escrow.update({
        where: { id: escrow.id },
        data: {
          status: 'PARTIALLY_RELEASED',
          releasedAt: null,
        },
      });
    });
  }
}
