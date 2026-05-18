import { ListingType, OrderStatus } from '@prisma/client';

export type ResaleShipmentLeg = {
  id?: string;
  type: string;
  status: string;
  trackingId?: string | null;
  providerTrackingUrl?: string | null;
  listerId?: string | null;
  buyerConfirmedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export const RESALE_LEG_BOOKED_STATUSES = new Set([
  'DISPATCHING',
  'DISPATCHED',
  'IN_TRANSIT',
  'COMPLETED',
]);

export function summarizeResaleLegStatuses(legs: ResaleShipmentLeg[]): {
  total: number;
  completed: number;
  booked: number;
  allCompleted: boolean;
  anyBooked: boolean;
} {
  const total = legs.length;
  const completed = legs.filter((l) => l.status === 'COMPLETED').length;
  const booked = legs.filter((l) =>
    RESALE_LEG_BOOKED_STATUSES.has(l.status),
  ).length;
  return {
    total,
    completed,
    booked,
    allCompleted: total > 0 && completed === total,
    anyBooked: booked > 0,
  };
}

/**
 * Resale buyer timeline step (0–3): placed → in transit → all delivered → order closed.
 * Uses per-leg status when RESALE shipments exist; otherwise falls back to order status.
 */
export function computeResaleMilestoneStep(
  legs: ResaleShipmentLeg[],
  orderStatus: OrderStatus | string,
): 0 | 1 | 2 | 3 {
  if (String(orderStatus) === OrderStatus.COMPLETED) return 3;

  const summary = summarizeResaleLegStatuses(resaleShipmentLegs(legs));
  if (summary.total > 0) {
    if (summary.allCompleted) return 2;
    if (summary.anyBooked || summary.completed > 0) return 1;
    return 0;
  }

  const st = String(orderStatus ?? '');
  if (st === OrderStatus.DELIVERED) return 2;
  if (st === OrderStatus.IN_TRANSIT || st === OrderStatus.CONFIRMED) return 1;
  return 0;
}

export function resaleProgressPercent(step: 0 | 1 | 2 | 3, milestoneCount: number): number {
  if (milestoneCount <= 1) return step >= 3 ? 100 : 0;
  if (step >= 3) return 100;
  return Math.round((step / (milestoneCount - 1)) * 100);
}

export type ResalePackageOrderItem = {
  productId?: string;
  days?: number;
  resaleListerAmount?: number | null;
  resaleShipmentId?: string | null;
  outboundShipmentId?: string | null;
  returnShipmentId?: string | null;
  product?: {
    name?: string | null;
    listingType?: string | null;
    resalePrice?: number | null;
    curator?: {
      id?: string;
      name?: string | null;
      profile?: {
        businessName?: string | null;
        fullName?: string | null;
      } | null;
    } | null;
  } | null;
};

export function curatorListerLabel(curator?: {
  name?: string | null;
  profile?: { businessName?: string | null; fullName?: string | null } | null;
} | null): string {
  return (
    curator?.profile?.businessName?.trim() ||
    curator?.profile?.fullName?.trim() ||
    curator?.name?.trim() ||
    'Seller'
  );
}

export function buildListerNameMapFromOrderItems(
  orderItems: ResalePackageOrderItem[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const oi of orderItems) {
    const curator = oi.product?.curator as { id?: string } | null | undefined;
    const id = curator?.id;
    if (id && !map.has(id)) {
      map.set(id, curatorListerLabel(oi.product?.curator));
    }
  }
  return map;
}

export function isRentalOrderItem(item: ResalePackageOrderItem): boolean {
  const lt = item.product?.listingType;
  return (
    (item.days ?? 0) > 0 &&
    (lt === 'RENTAL' || lt === 'RENT_OR_RESALE')
  );
}

export function orderHasRentalItems(
  orderItems: ResalePackageOrderItem[],
): boolean {
  return orderItems.some(isRentalOrderItem);
}

export type ResalePackageShipment = {
  id: string;
  type: string;
  status: string;
  listerId?: string | null;
  trackingId?: string | null;
  providerTrackingUrl?: string | null;
  scheduledDate?: Date | string | null;
  scheduledWindowStart?: Date | string | null;
  scheduledWindowEnd?: Date | string | null;
  dispatchedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type ResalePackageRow = {
  shipmentId: string;
  listerId: string | null;
  listerName: string | null;
  itemLabel: string;
  itemNames: string[];
  status: string;
  scheduledDate: string | null;
  windowSummary: string | null;
  trackingId: string | null;
  providerTrackingUrl: string | null;
  isDelivered: boolean;
  isBooked: boolean;
};

export function isResalePurchaseOrderItem(item: ResalePackageOrderItem): boolean {
  const lt = item.product?.listingType;
  return (
    lt === 'RESALE' || (lt === 'RENT_OR_RESALE' && (item.days ?? 0) === 0)
  );
}

export function resaleLinePriceNgn(item: ResalePackageOrderItem): number {
  const fromLine = item.resaleListerAmount;
  if (fromLine != null && Number(fromLine) > 0) return Number(fromLine);
  const fromProduct = item.product?.resalePrice;
  if (fromProduct != null && Number(fromProduct) > 0) return Number(fromProduct);
  return 0;
}

/**
 * Buyer-facing package rows: one row per RESALE shipment, or per item when no legs exist.
 * Uses product names as the primary label (not seller name only).
 */
export function buildResalePackageRows(input: {
  orderItems: ResalePackageOrderItem[];
  shipments: ResalePackageShipment[];
  listerNameById?: Map<string, string>;
  formatWindow?: (start: Date, end: Date) => string;
}): ResalePackageRow[] {
  const resaleItems = input.orderItems.filter(isResalePurchaseOrderItem);
  if (resaleItems.length === 0) return [];

  const legs = input.shipments.filter((s) => s.type === 'RESALE');
  const fmt = input.formatWindow;

  const rowFromLeg = (
    leg: ResalePackageShipment,
    linked: ResalePackageOrderItem[],
  ): ResalePackageRow => {
    const itemNames = linked.map((i) => i.product?.name?.trim() || 'Item');
    const itemLabel = itemNames.join(', ');
    const listerId = leg.listerId ?? null;
    const windowSummary =
      leg.scheduledWindowStart && leg.scheduledWindowEnd && fmt
        ? fmt(new Date(leg.scheduledWindowStart), new Date(leg.scheduledWindowEnd))
        : null;
    const scheduledDate = leg.scheduledDate
      ? new Date(leg.scheduledDate).toISOString()
      : null;
    return {
      shipmentId: leg.id,
      listerId,
      listerName: listerId
        ? input.listerNameById?.get(listerId) ?? null
        : null,
      itemLabel,
      itemNames,
      status: leg.status,
      scheduledDate,
      windowSummary,
      trackingId: leg.trackingId ?? null,
      providerTrackingUrl: leg.providerTrackingUrl ?? null,
      isDelivered: leg.status === 'COMPLETED',
      isBooked: RESALE_LEG_BOOKED_STATUSES.has(leg.status),
    };
  };

  if (legs.length === 0) {
    return resaleItems.map((item) => ({
      shipmentId: item.resaleShipmentId ?? item.productId ?? 'item',
      listerId: null,
      listerName: null,
      itemLabel: item.product?.name?.trim() || 'Item',
      itemNames: [item.product?.name?.trim() || 'Item'],
      status: 'PENDING',
      scheduledDate: null,
      windowSummary: null,
      trackingId: null,
      providerTrackingUrl: null,
      isDelivered: false,
      isBooked: false,
    }));
  }

  if (legs.length === 1) {
    const leg = legs[0];
    const linked =
      resaleItems.filter((i) => i.resaleShipmentId === leg.id).length > 0
        ? resaleItems.filter((i) => i.resaleShipmentId === leg.id)
        : resaleItems;
    return [rowFromLeg(leg, linked)];
  }

  return legs.map((leg) => {
    let linked = resaleItems.filter((i) => i.resaleShipmentId === leg.id);
    if (linked.length === 0) {
      linked = resaleItems.filter(
        (i) => !i.resaleShipmentId || i.resaleShipmentId === leg.id,
      );
    }
    if (linked.length === 0) {
      linked = [resaleItems[0]];
    }
    return rowFromLeg(leg, linked);
  });
}

/** Rental outbound legs (lister → renter), labelled with rented product names. */
export function buildRentalOutboundPackageRows(input: {
  orderItems: ResalePackageOrderItem[];
  shipments: ResalePackageShipment[];
  listerNameById?: Map<string, string>;
  formatWindow?: (start: Date, end: Date) => string;
}): ResalePackageRow[] {
  const rentalItems = input.orderItems.filter(isRentalOrderItem);
  if (rentalItems.length === 0) return [];

  const legs = input.shipments.filter((s) => s.type === 'OUTBOUND');
  const fmt = input.formatWindow;

  const rowFromLeg = (
    leg: ResalePackageShipment,
    linked: ResalePackageOrderItem[],
  ): ResalePackageRow => {
    const itemNames = linked.map((i) => i.product?.name?.trim() || 'Item');
    const itemLabel = itemNames.join(', ');
    const listerId = leg.listerId ?? null;
    const windowSummary =
      leg.scheduledWindowStart && leg.scheduledWindowEnd && fmt
        ? fmt(new Date(leg.scheduledWindowStart), new Date(leg.scheduledWindowEnd))
        : null;
    const scheduledDate = leg.scheduledDate
      ? new Date(leg.scheduledDate).toISOString()
      : null;
    return {
      shipmentId: leg.id,
      listerId,
      listerName: listerId
        ? input.listerNameById?.get(listerId) ?? null
        : null,
      itemLabel,
      itemNames,
      status: leg.status,
      scheduledDate,
      windowSummary,
      trackingId: leg.trackingId ?? null,
      providerTrackingUrl: leg.providerTrackingUrl ?? null,
      isDelivered: leg.status === 'COMPLETED',
      isBooked: RESALE_LEG_BOOKED_STATUSES.has(leg.status),
    };
  };

  if (legs.length === 0) {
    return rentalItems.map((item) => ({
      shipmentId: item.outboundShipmentId ?? item.productId ?? 'rental-item',
      listerId: null,
      listerName: null,
      itemLabel: item.product?.name?.trim() || 'Rental item',
      itemNames: [item.product?.name?.trim() || 'Rental item'],
      status: 'PENDING',
      scheduledDate: null,
      windowSummary: null,
      trackingId: null,
      providerTrackingUrl: null,
      isDelivered: false,
      isBooked: false,
    }));
  }

  if (legs.length === 1) {
    const leg = legs[0];
    const linked =
      rentalItems.filter((i) => i.outboundShipmentId === leg.id).length > 0
        ? rentalItems.filter((i) => i.outboundShipmentId === leg.id)
        : rentalItems;
    return [rowFromLeg(leg, linked)];
  }

  return legs.map((leg) => {
    let linked = rentalItems.filter((i) => i.outboundShipmentId === leg.id);
    if (linked.length === 0) linked = rentalItems;
    return rowFromLeg(leg, linked);
  });
}

export type ResaleOrderItemLine = {
  days?: number;
  product?: { listingType?: string | null } | null;
};

export function orderHasRentalLines(
  orderItems: ResaleOrderItemLine[],
): boolean {
  return orderItems.some((oi) => {
    const lt = oi.product?.listingType;
    return (
      (oi.days ?? 0) > 0 &&
      (lt === 'RENTAL' || lt === 'RENT_OR_RESALE')
    );
  });
}

const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.IN_DISPUTE,
  OrderStatus.RETURNED,
]);

export function orderHasResalePurchaseItems(
  orderItems: ResaleOrderItemLine[],
): boolean {
  return orderItems.some((oi) => {
    const lt = oi.product?.listingType;
    return (
      lt === 'RESALE' || (lt === 'RENT_OR_RESALE' && (oi.days ?? 0) === 0)
    );
  });
}

/** Resale purchase shipment legs on an order (lister → buyer). */
export function resaleShipmentLegs(
  shipments: ResaleShipmentLeg[],
): ResaleShipmentLeg[] {
  return shipments.filter((s) => s.type === 'RESALE');
}

/**
 * True when every RESALE leg is carrier/admin-delivered (COMPLETED).
 * If the order has no RESALE legs (legacy), falls back to order-level delivery signals.
 */
export function areResaleShipmentLegsDelivered(
  shipments: ResaleShipmentLeg[],
  order?: {
    status?: OrderStatus | string;
    deliveredAt?: Date | null;
  },
): boolean {
  const legs = resaleShipmentLegs(shipments);
  if (legs.length > 0) {
    return legs.every((s) => s.status === 'COMPLETED');
  }
  if (!order) return false;
  if (order.deliveredAt) return true;
  const st = String(order.status ?? '');
  return st === OrderStatus.DELIVERED || st === OrderStatus.COMPLETED;
}

/** RESALE leg delivered and not yet buyer-confirmed. */
export function canConfirmResaleShipment(leg: ResaleShipmentLeg): boolean {
  return (
    leg.type === 'RESALE' &&
    leg.status === 'COMPLETED' &&
    !leg.buyerConfirmedAt
  );
}

export function listConfirmableResaleShipments(
  shipments: ResaleShipmentLeg[],
): ResaleShipmentLeg[] {
  return resaleShipmentLegs(shipments).filter(canConfirmResaleShipment);
}

export function allResaleShipmentsBuyerConfirmed(
  shipments: ResaleShipmentLeg[],
): boolean {
  const legs = resaleShipmentLegs(shipments);
  if (legs.length === 0) return false;
  return legs.every(
    (l) => l.status === 'COMPLETED' && Boolean(l.buyerConfirmedAt),
  );
}

export function orderItemsForResaleShipment(
  orderItems: ResalePackageOrderItem[],
  shipmentId: string,
  shipments: ResaleShipmentLeg[],
): ResalePackageOrderItem[] {
  const linked = orderItems.filter(
    (i) =>
      isResalePurchaseOrderItem(i) && i.resaleShipmentId === shipmentId,
  );
  if (linked.length > 0) return linked;
  const legs = resaleShipmentLegs(shipments);
  if (legs.length === 1 && legs[0].id === shipmentId) {
    return orderItems.filter(isResalePurchaseOrderItem);
  }
  return [];
}

export function resaleReleaseAmountForItems(
  items: ResalePackageOrderItem[],
): number {
  return items.reduce((sum, item) => sum + resaleLinePriceNgn(item), 0);
}

/** Rental portion finished: return leg delivered or order returned. */
export function isRentalFulfilled(input: {
  orderItems: ResaleOrderItemLine[];
  shipments: ResaleShipmentLeg[];
  orderStatus: OrderStatus | string;
}): boolean {
  if (!orderHasRentalLines(input.orderItems)) return true;

  const returnLegs = input.shipments.filter((s) => s.type === 'RETURN');
  if (returnLegs.length > 0) {
    return returnLegs.every((l) => l.status === 'COMPLETED');
  }

  const st = String(input.orderStatus ?? '').toUpperCase();
  return st === OrderStatus.RETURNED || st === OrderStatus.COMPLETED;
}

/**
 * Close the order only when every RESALE shipment is buyer-confirmed and
 * any rental on the order is fully returned.
 */
export function shouldCompleteOrderAfterResaleFlow(input: {
  orderItems: ResaleOrderItemLine[];
  shipments: ResaleShipmentLeg[];
  orderStatus: OrderStatus | string;
}): boolean {
  if (!orderHasResalePurchaseItems(input.orderItems)) return false;

  const legs = resaleShipmentLegs(input.shipments);
  if (legs.length > 0) {
    if (!allResaleShipmentsBuyerConfirmed(input.shipments)) return false;
  }

  return isRentalFulfilled(input);
}

/**
 * Buyer may confirm when at least one RESALE leg is delivered and unconfirmed.
 * Legacy orders without RESALE legs fall back to order-level delivery.
 */
export function canBuyerConfirmResaleReceipt(input: {
  listingType: ListingType | string;
  status: OrderStatus | string;
  deliveredAt?: Date | null;
  shipments?: ResaleShipmentLeg[];
  orderItems: ResaleOrderItemLine[];
}): boolean {
  const st = input.status as OrderStatus;
  if (TERMINAL_ORDER_STATUSES.has(st)) return false;

  const lt = input.listingType;
  if (lt !== ListingType.RESALE && lt !== ListingType.RENT_OR_RESALE) {
    return false;
  }
  if (!orderHasResalePurchaseItems(input.orderItems)) return false;

  const pending = listConfirmableResaleShipments(input.shipments ?? []);
  if (pending.length > 0) return true;

  const legs = resaleShipmentLegs(input.shipments ?? []);
  if (legs.length > 0) return false;

  return areResaleShipmentLegsDelivered(input.shipments ?? [], {
    status: input.status,
    deliveredAt: input.deliveredAt,
  });
}

/** Hours after delivery before resale orders auto-complete (default 24). */
export function getResaleInspectionHours(): number {
  const hoursRaw = process.env.RESALE_INSPECTION_HOURS?.trim();
  if (hoursRaw) {
    const h = parseInt(hoursRaw, 10);
    if (Number.isFinite(h) && h >= 1) return Math.min(h, 24 * 30);
  }
  const daysRaw = process.env.RESALE_INSPECTION_DAYS?.trim();
  if (daysRaw) {
    const d = parseInt(daysRaw, 10);
    if (Number.isFinite(d) && d >= 1) return Math.min(d, 30) * 24;
  }
  return 24;
}

/** Cutoff timestamp: orders delivered before this are eligible for auto-complete. */
export function getResaleInspectionCutoffDate(): Date {
  const cutoff = new Date();
  cutoff.setTime(cutoff.getTime() - getResaleInspectionHours() * 60 * 60 * 1000);
  return cutoff;
}

/** Human label for emails and copy (e.g. "24 hours"). */
export function getResaleInspectionPeriodLabel(): string {
  const hours = getResaleInspectionHours();
  if (hours === 1) return '1 hour';
  if (hours < 24) return `${hours} hours`;
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return `${hours} hours`;
}

export function buildRenterOrderPageUrl(displayOrderId: string): string {
  const base =
    process.env.CLIENT_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    'https://relisted.com';
  return `${base.replace(/\/$/, '')}/renters/orders/${encodeURIComponent(displayOrderId)}`;
}

/** @deprecated Use getResaleInspectionHours */
export function getResaleInspectionDays(): number {
  return Math.max(1, Math.ceil(getResaleInspectionHours() / 24));
}
