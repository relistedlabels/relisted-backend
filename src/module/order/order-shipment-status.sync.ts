import { ListingType, OrderStatus } from '@prisma/client';
import type { PrismaService } from 'src/services/prisma/prisma.service';
import { releaseRentalEscrowOnOutboundDelivery } from './release-rental-escrow-on-delivery';

const TERMINAL_ORDER: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.IN_DISPUTE,
];

const SHIPMENT_DRIVEN_RANK: OrderStatus[] = [
  OrderStatus.PROCESSING,
  OrderStatus.ACCEPTED,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.DELIVERED,
  OrderStatus.ACTIVE,
  OrderStatus.RETURN_DUE,
  OrderStatus.RETURNED,
  OrderStatus.COMPLETED,
];

function orderStatusRank(status: OrderStatus): number {
  const i = SHIPMENT_DRIVEN_RANK.indexOf(status);
  return i === -1 ? -1 : i;
}

function allLegsIn(
  legs: Array<{ status: string }>,
  terminal: Set<string>,
): boolean {
  if (legs.length === 0) return false;
  return legs.every((l) => terminal.has(l.status));
}

function deriveOutboundTarget(
  statuses: string[],
  rentalOutboundCompleteIsActive: boolean,
): OrderStatus | null {
  if (statuses.length === 0) return null;
  if (statuses.every((s) => s === 'COMPLETED')) {
    return rentalOutboundCompleteIsActive
      ? OrderStatus.ACTIVE
      : OrderStatus.DELIVERED;
  }
  if (statuses.some((s) => s === 'IN_TRANSIT')) return OrderStatus.IN_TRANSIT;
  if (statuses.some((s) => ['DISPATCHED', 'IN_TRANSIT', 'COMPLETED'].includes(s))) {
    return OrderStatus.CONFIRMED;
  }
  return OrderStatus.CONFIRMED;
}

function deriveReturnTarget(returnLegs: Array<{ status: string }>): OrderStatus | null {
  if (returnLegs.length === 0) return null;
  if (allLegsIn(returnLegs, new Set(['COMPLETED']))) {
    return OrderStatus.RETURNED;
  }
  return null;
}

function isRentalish(listingType: ListingType): boolean {
  return (
    listingType === ListingType.RENTAL ||
    listingType === ListingType.RENT_OR_RESALE
  );
}

/**
 * Aligns `Order.status` with shipment legs: OUTBOUND (+ RETURN for rentals),
 * RESALE-only for pure resale orders. Monotonic within SHIPMENT_DRIVEN_RANK.
 */
export async function syncOrderStatusFromShipments(
  prisma: PrismaService,
  orderId: string,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderId: true,
      status: true,
      listingType: true,
      dispatchedAt: true,
      deliveredAt: true,
      shipments: { select: { type: true, status: true } },
    },
  });

  if (!order || TERMINAL_ORDER.includes(order.status)) return;

  let target: OrderStatus | null = null;

  if (order.listingType === ListingType.RESALE) {
    const resaleLegs = order.shipments.filter((s) => s.type === 'RESALE');
    const statuses = resaleLegs.map((l) => l.status);
    if (statuses.length === 0) return;
    target = deriveOutboundTarget(statuses, false);
  } else if (isRentalish(order.listingType)) {
    const outbound = order.shipments.filter((s) => s.type === 'OUTBOUND');
    const returnLegs = order.shipments.filter((s) => s.type === 'RETURN');

    const returnTarget = deriveReturnTarget(returnLegs);
    if (returnTarget) {
      target = returnTarget;
    } else {
      const obStatuses = outbound.map((l) => l.status);
      if (obStatuses.length === 0) return;
      target = deriveOutboundTarget(obStatuses, true);
    }
  } else {
    return;
  }

  if (!target) return;

  if (isRentalish(order.listingType) && order.status === OrderStatus.PROCESSING) {
    return;
  }

  const curRank = orderStatusRank(order.status);
  const nextRank = orderStatusRank(target);
  if (curRank === -1 || nextRank === -1 || nextRank <= curRank) return;

  const now = new Date();
  const data: {
    status: OrderStatus;
    dispatchedAt?: Date;
    deliveredAt?: Date;
  } = { status: target };

  if (
    (target === OrderStatus.IN_TRANSIT ||
      target === OrderStatus.DELIVERED ||
      target === OrderStatus.ACTIVE) &&
    !order.dispatchedAt
  ) {
    data.dispatchedAt = now;
  }

  if (
    (target === OrderStatus.DELIVERED || target === OrderStatus.ACTIVE) &&
    !order.deliveredAt
  ) {
    data.deliveredAt = now;
  }

  if (target === OrderStatus.ACTIVE && isRentalish(order.listingType)) {
    await releaseRentalEscrowOnOutboundDelivery(
      prisma,
      order.id,
      order.orderId,
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data,
  });
}
