import { ListingType, OrderStatus } from '@prisma/client';
import {
  type ResaleOrderItemLine,
  type ResalePackageOrderItem,
  type ResaleShipmentLeg,
  orderHasRentalLines,
} from './resale-delivery.util';

export type { ResaleShipmentLeg as RentalShipmentLeg };

const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.IN_DISPUTE,
  OrderStatus.RETURNED,
]);

/** Rental outbound legs (lister → renter). */
export function rentalOutboundShipmentLegs(
  shipments: ResaleShipmentLeg[],
): ResaleShipmentLeg[] {
  return shipments.filter((s) => s.type === 'OUTBOUND');
}

/** OUTBOUND leg delivered and not yet renter-confirmed. */
export function canConfirmRentalShipment(leg: ResaleShipmentLeg): boolean {
  return (
    leg.type === 'OUTBOUND' &&
    leg.status === 'COMPLETED' &&
    !leg.buyerConfirmedAt
  );
}

export function listConfirmableRentalShipments(
  shipments: ResaleShipmentLeg[],
): ResaleShipmentLeg[] {
  return rentalOutboundShipmentLegs(shipments).filter(canConfirmRentalShipment);
}

export function allRentalOutboundShipmentsBuyerConfirmed(
  shipments: ResaleShipmentLeg[],
): boolean {
  const legs = rentalOutboundShipmentLegs(shipments);
  if (legs.length === 0) return false;
  return legs.every(
    (l) => l.status === 'COMPLETED' && Boolean(l.buyerConfirmedAt),
  );
}

export function orderItemsForRentalShipment(
  orderItems: ResalePackageOrderItem[],
  shipmentId: string,
  shipments: ResaleShipmentLeg[],
): ResalePackageOrderItem[] {
  const linked = orderItems.filter(
    (i) =>
      (i.days ?? 0) > 0 &&
      (i.product?.listingType === 'RENTAL' ||
        i.product?.listingType === 'RENT_OR_RESALE') &&
      i.outboundShipmentId === shipmentId,
  );
  if (linked.length > 0) return linked;
  const legs = rentalOutboundShipmentLegs(shipments);
  if (legs.length === 1 && legs[0].id === shipmentId) {
    return orderItems.filter(
      (i) =>
        (i.days ?? 0) > 0 &&
        (i.product?.listingType === 'RENTAL' ||
          i.product?.listingType === 'RENT_OR_RESALE'),
    );
  }
  return [];
}

/** Hours after outbound delivery before rental auto-confirms (default 1). */
export function getRentalInspectionHours(): number {
  const hoursRaw = process.env.RENTAL_INSPECTION_HOURS?.trim();
  if (hoursRaw) {
    const h = parseInt(hoursRaw, 10);
    if (Number.isFinite(h) && h >= 1) return Math.min(h, 24 * 7);
  }
  return 1;
}

export function getRentalInspectionCutoffDate(): Date {
  const cutoff = new Date();
  cutoff.setTime(
    cutoff.getTime() - getRentalInspectionHours() * 60 * 60 * 1000,
  );
  return cutoff;
}

export function getRentalInspectionPeriodLabel(): string {
  const hours = getRentalInspectionHours();
  if (hours === 1) return '1 hour';
  if (hours < 24) return `${hours} hours`;
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return `${hours} hours`;
}

function legDeliveredAt(leg: ResaleShipmentLeg): Date | null {
  const raw = leg.updatedAt;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True while the renter may still confirm or dispute this outbound leg. */
export function isRentalShipmentWithinInspectionWindow(
  leg: ResaleShipmentLeg,
  now = new Date(),
): boolean {
  if (leg.type !== 'OUTBOUND' || leg.status !== 'COMPLETED') return false;
  if (leg.buyerConfirmedAt) return false;
  const deliveredAt = legDeliveredAt(leg);
  if (!deliveredAt) return true;
  const cutoffMs = getRentalInspectionHours() * 60 * 60 * 1000;
  return now.getTime() - deliveredAt.getTime() <= cutoffMs;
}

export function rentalInspectionDeadlineForLeg(
  leg: ResaleShipmentLeg,
): Date | null {
  const deliveredAt = legDeliveredAt(leg);
  if (!deliveredAt) return null;
  return new Date(
    deliveredAt.getTime() + getRentalInspectionHours() * 60 * 60 * 1000,
  );
}

/**
 * Renter may confirm when at least one OUTBOUND leg is delivered and unconfirmed
 * within the inspection window (or legacy orders without OUTBOUND legs).
 */
export function canBuyerConfirmRentalReceipt(input: {
  listingType: ListingType | string;
  status: OrderStatus | string;
  deliveredAt?: Date | null;
  shipments?: ResaleShipmentLeg[];
  orderItems: ResaleOrderItemLine[];
}): boolean {
  const st = input.status as OrderStatus;
  if (TERMINAL_ORDER_STATUSES.has(st)) return false;

  const lt = input.listingType;
  if (lt !== ListingType.RENTAL && lt !== ListingType.RENT_OR_RESALE) {
    return false;
  }
  if (!orderHasRentalLines(input.orderItems)) return false;

  const pending = listConfirmableRentalShipments(input.shipments ?? []).filter(
    (leg) => isRentalShipmentWithinInspectionWindow(leg),
  );
  if (pending.length > 0) return true;

  const legs = rentalOutboundShipmentLegs(input.shipments ?? []);
  if (legs.length > 0) return false;

  if (!input.deliveredAt) return false;
  const cutoff = getRentalInspectionCutoffDate();
  return input.deliveredAt > cutoff;
}

/** Renter may raise a delivery dispute only during the inspection window. */
export function canRenterRaiseRentalDeliveryDispute(input: {
  listingType: ListingType | string;
  status: OrderStatus | string;
  deliveredAt?: Date | null;
  shipments?: ResaleShipmentLeg[];
  orderItems: ResaleOrderItemLine[];
  hasOpenDispute?: boolean;
}): boolean {
  if (input.hasOpenDispute) return false;
  const st = input.status as OrderStatus;
  if (TERMINAL_ORDER_STATUSES.has(st)) return false;

  const lt = input.listingType;
  if (lt !== ListingType.RENTAL && lt !== ListingType.RENT_OR_RESALE) {
    return false;
  }
  if (!orderHasRentalLines(input.orderItems)) return false;

  const inWindow = listConfirmableRentalShipments(input.shipments ?? []).some(
    (leg) => isRentalShipmentWithinInspectionWindow(leg),
  );
  if (inWindow) return true;

  const legs = rentalOutboundShipmentLegs(input.shipments ?? []);
  if (legs.length > 0) return false;

  if (!input.deliveredAt) return false;
  return input.deliveredAt > getRentalInspectionCutoffDate();
}

export function shouldActivateRentalAfterOutboundConfirm(input: {
  orderItems: ResaleOrderItemLine[];
  shipments: ResaleShipmentLeg[];
}): boolean {
  if (!orderHasRentalLines(input.orderItems)) return false;
  const legs = rentalOutboundShipmentLegs(input.shipments);
  if (legs.length === 0) return true;
  return allRentalOutboundShipmentsBuyerConfirmed(input.shipments);
}
