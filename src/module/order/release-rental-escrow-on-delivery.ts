import type { PrismaService } from 'src/services/prisma/prisma.service';
import { releaseRentalEscrowForListerOnConfirm } from './release-rental-escrow-on-confirm';

/**
 * @deprecated Rental escrow is released on renter confirmation (or auto-confirm after inspection).
 * Kept for callers that batch-release all listers on a legacy path.
 */
export async function releaseRentalEscrowOnOutboundDelivery(
  prisma: PrismaService,
  orderInternalId: string,
  orderDisplayId: string,
): Promise<void> {
  const escrows = await prisma.escrow.findMany({
    where: { orderId: orderInternalId },
    select: { listerId: true },
  });

  for (const escrow of escrows) {
    await prisma.$transaction(async (tx) => {
      await releaseRentalEscrowForListerOnConfirm(tx, {
        orderInternalId,
        orderDisplayId,
        listerId: escrow.listerId,
        isAuto: false,
      });
    });
  }
}
