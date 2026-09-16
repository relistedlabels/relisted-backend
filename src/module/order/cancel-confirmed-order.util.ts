import { BadRequestException } from '@nestjs/common';
import {
  EscrowStatus,
  OrderStatus,
  Prisma,
  ShipmentType,
} from '@prisma/client';
import {
  markRentalProductsAvailableForOrder,
  markRentalsReturnedForOrder,
} from './mark-rentals-returned.util';
import { markResaleProductsAvailableForOrder } from './mark-resale-products-available.util';

const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.COMPLETED,
  OrderStatus.IN_DISPUTE,
]);

const CANCELLABLE_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.ACCEPTED,
]);

const SHIPPED_SHIPMENT_STATUSES = new Set([
  'DISPATCHED',
  'IN_TRANSIT',
  'COMPLETED',
]);

export type OrderForCancellation = {
  id: string;
  orderId: string;
  userId: string;
  status: OrderStatus;
  totalAmountPaid: number | null;
  escrows: {
    id: string;
    status: EscrowStatus;
    collateralAmount: number;
    resaleReleasedAmount: number | null;
  }[];
  shipments: {
    id: string;
    type: ShipmentType;
    status: string;
  }[];
};

export function assertOrderEligibleForAdminCancel(
  order: OrderForCancellation,
): void {
  if (TERMINAL_ORDER_STATUSES.has(order.status)) {
    throw new BadRequestException('This order can no longer be cancelled.');
  }

  if (!CANCELLABLE_ORDER_STATUSES.has(order.status)) {
    throw new BadRequestException(
      'This order can only be cancelled while it is confirmed and before delivery starts.',
    );
  }

  const outboundOrResale = order.shipments.filter(
    (s) => s.type !== ShipmentType.RETURN,
  );
  if (
    outboundOrResale.some((s) => SHIPPED_SHIPMENT_STATUSES.has(s.status))
  ) {
    throw new BadRequestException(
      'This order cannot be cancelled because delivery has already started.',
    );
  }

  if (
    order.escrows.some(
      (e) =>
        e.status !== EscrowStatus.LOCKED ||
        (e.resaleReleasedAmount ?? 0) > 0,
    )
  ) {
    throw new BadRequestException(
      'This order cannot be cancelled because payment has already been released.',
    );
  }
}

export async function cancelConfirmedOrderInTransaction(
  tx: Prisma.TransactionClient,
  order: OrderForCancellation,
): Promise<{
  refundAmount: number;
  collateralReleased: number;
  productIds: string[];
}> {
  assertOrderEligibleForAdminCancel(order);

  const refundAmount = Math.max(0, Math.round(Number(order.totalAmountPaid) || 0));
  if (refundAmount <= 0) {
    throw new BadRequestException(
      'This order has no payment to refund.',
    );
  }

  const collateralReleased = order.escrows.reduce(
    (sum, e) => sum + Math.max(0, Number(e.collateralAmount) || 0),
    0,
  );

  await tx.shipment.updateMany({
    where: {
      orderId: order.id,
      status: { in: ['PENDING', 'DISPATCHING', 'DISPATCH_FAILED'] },
    },
    data: { status: 'CANCELLED' },
  });

  const renterWallet = await tx.wallet.findUnique({
    where: { userId: order.userId },
  });
  if (
    collateralReleased > 0 &&
    (!renterWallet || renterWallet.collateralBalance < collateralReleased)
  ) {
    throw new BadRequestException(
      'Unable to refund this order. Wallet collateral balance is insufficient.',
    );
  }

  const updatedWallet = await tx.wallet.upsert({
    where: { userId: order.userId },
    create: {
      userId: order.userId,
      mainBalance: refundAmount - collateralReleased,
      availableBalance: refundAmount,
      collateralBalance: 0,
    },
    update: {
      availableBalance: { increment: refundAmount },
      mainBalance: { increment: refundAmount - collateralReleased },
      ...(collateralReleased > 0
        ? { collateralBalance: { decrement: collateralReleased } }
        : {}),
    },
  });

  await tx.walletTransaction.create({
    data: {
      walletId: updatedWallet.id,
      amount: refundAmount,
      type: 'MAIN',
      status: 'SUCCESS',
      note: `Refund for cancelled order ${order.orderId} (Collateral released: ${collateralReleased})`,
      orderId: order.id,
    },
  });

  await tx.escrow.updateMany({
    where: { orderId: order.id, status: EscrowStatus.LOCKED },
    data: { status: EscrowStatus.REFUNDED },
  });

  await markRentalsReturnedForOrder(tx, order.id);
  await markRentalProductsAvailableForOrder(tx, order.id);
  const resaleProductIds = await markResaleProductsAvailableForOrder(
    tx,
    order.id,
  );

  const rentalProductIds = (
    await tx.orderItem.findMany({
      where: { orderId: order.id, days: { gt: 0 } },
      select: { productId: true },
    })
  ).map((item) => item.productId);

  await tx.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.CANCELLED },
  });

  const productIds = [...new Set([...rentalProductIds, ...resaleProductIds])];
  return { refundAmount, collateralReleased, productIds };
}
