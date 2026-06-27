import type { Prisma } from '@prisma/client';
import { incrementClosetRevenueForListerPayout } from '../closet/closet-revenue.util';
import { getRentalInspectionPeriodLabel } from './rental-delivery.util';

type Tx = Prisma.TransactionClient;

/**
 * Credits the lister rental portion when the renter confirms outbound delivery.
 * Idempotent: only acts on escrows still LOCKED with rentalAmount > 0.
 */
export async function releaseRentalEscrowForListerOnConfirm(
  tx: Tx,
  input: {
    orderInternalId: string;
    orderDisplayId: string;
    listerId: string;
    isAuto: boolean;
  },
): Promise<void> {
  const { orderInternalId, orderDisplayId, listerId, isAuto } = input;

  const escrow = await tx.escrow.findUnique({
    where: {
      orderId_listerId: { orderId: orderInternalId, listerId },
    },
  });
  if (!escrow) return;
  if (escrow.status !== 'LOCKED' || !(escrow.rentalAmount || 0)) return;

  const releaseAmount = escrow.rentalAmount;
  const hasResaleAmount = (escrow.resaleAmount || 0) > 0;

  const listerWallet = await tx.wallet.upsert({
    where: { userId: listerId },
    create: {
      userId: listerId,
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
      note: isAuto
        ? hasResaleAmount
          ? `Rental payment auto-released after ${getRentalInspectionPeriodLabel()} inspection for order ${orderDisplayId} (resale pending buyer confirmation)`
          : `Rental payment auto-released after inspection period for order ${orderDisplayId}`
        : hasResaleAmount
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

  await incrementClosetRevenueForListerPayout(tx, {
    orderId: orderInternalId,
    listerId,
    amount: releaseAmount,
    split: 'RENTAL_CLEANING',
  });
}
