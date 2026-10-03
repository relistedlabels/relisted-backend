import type { Prisma } from '@prisma/client';
import {
  escrowFeeBaseAlreadyReleased,
  escrowPlatformFeeDue,
  platformFeeNoteSuffix,
} from './platform-fee.util';
import { incrementClosetRevenueForListerPayout } from '../closet/closet-revenue.util';

type Tx = Prisma.TransactionClient;

/**
 * Credits the lister for one RESALE shipment confirm. Tracks cumulative resaleReleasedAmount.
 */
export async function releaseResaleEscrowForShipment(
  tx: Tx,
  input: {
    orderInternalId: string;
    orderDisplayId: string;
    listerId: string;
    releaseAmount: number;
    isAuto: boolean;
  },
): Promise<void> {
  const { orderInternalId, orderDisplayId, listerId, releaseAmount, isAuto } =
    input;
  if (releaseAmount <= 0) return;

  const escrow = await tx.escrow.findUnique({
    where: {
      orderId_listerId: { orderId: orderInternalId, listerId },
    },
  });
  if (!escrow) {
    throw new Error('Escrow not found for lister');
  }

  const resaleCap = escrow.resaleAmount ?? 0;
  const alreadyReleased = escrow.resaleReleasedAmount ?? 0;
  const remaining = Math.max(0, resaleCap - alreadyReleased);
  const payout = Math.min(releaseAmount, remaining);
  if (payout <= 0) return;
  const platformFee = escrowPlatformFeeDue(
    escrow,
    escrowFeeBaseAlreadyReleased(escrow) + payout,
  );
  const netPayout = payout - platformFee;

  const listerWallet = await tx.wallet.upsert({
    where: { userId: listerId },
    create: {
      userId: listerId,
      mainBalance: netPayout,
      availableBalance: netPayout,
    },
    update: {
      mainBalance: { increment: netPayout },
      availableBalance: { increment: netPayout },
    },
  });

  await tx.walletTransaction.create({
    data: {
      walletId: listerWallet.id,
      amount: netPayout,
      type: 'MAIN',
      status: 'SUCCESS',
      note: isAuto
        ? `Resale payment auto-released for order ${orderDisplayId}${platformFeeNoteSuffix(platformFee)}`
        : `Resale payment released for order ${orderDisplayId}${platformFeeNoteSuffix(platformFee)}`,
      orderId: orderInternalId,
    },
  });

  const nextReleased = alreadyReleased + payout;

  await tx.escrow.update({
    where: { id: escrow.id },
    data: {
      resaleReleasedAmount: nextReleased,
      ...(platformFee > 0
        ? { platformFeeAmount: { increment: platformFee } }
        : {}),
    },
  });

  await incrementClosetRevenueForListerPayout(tx, {
    orderId: orderInternalId,
    listerId,
    amount: netPayout,
    split: 'RESALE',
  });
}

/** Mark all escrows released when the whole order is completed. */
export async function finalizeEscrowsOnOrderComplete(
  tx: Tx,
  orderInternalId: string,
): Promise<void> {
  await tx.escrow.updateMany({
    where: { orderId: orderInternalId, status: { not: 'RELEASED' } },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });
}
