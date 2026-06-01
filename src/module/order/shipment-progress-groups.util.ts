import { OrderStatus } from '@prisma/client';
import {
  RESALE_LEG_BOOKED_STATUSES,
  type ResalePackageOrderItem,
  type ResalePackageRow,
  type ResalePackageShipment,
  buildRentalOutboundPackageRows,
  buildResalePackageRows,
  curatorListerLabel,
  isRentalOrderItem,
  isResalePurchaseOrderItem,
} from './resale-delivery.util';

export type ShipmentProgressMilestone = {
  milestone: string;
  label: string;
  description: string;
  timestamp: string | null;
  status: 'completed' | 'current' | 'pending';
};

export type ShipmentLegDetail = {
  legType: 'OUTBOUND' | 'RETURN' | 'RESALE';
  shipmentId: string;
  status: string;
  trackingId: string | null;
  providerTrackingUrl: string | null;
  scheduledDate: string | null;
  windowSummary: string | null;
  isBooked: boolean;
  isDelivered: boolean;
};

export type ShipmentProgressGroup = {
  id: string;
  kind: 'rental' | 'resale';
  title: string;
  itemNames: string[];
  listerName: string | null;
  delivery: ShipmentLegDetail | null;
  return: ShipmentLegDetail | null;
  timeline: ShipmentProgressMilestone[];
  percentComplete: number;
  currentLabel: string;
};

export type ShipmentProgressOverview = {
  percentComplete: number;
  summaryLabel: string;
  timeline: ShipmentProgressMilestone[];
  groups: ShipmentProgressGroup[];
};

function legDetail(
  leg: ResalePackageShipment,
  legType: 'OUTBOUND' | 'RETURN' | 'RESALE',
  formatWindow?: (start: Date, end: Date) => string,
): ShipmentLegDetail {
  const windowStart = leg.scheduledWindowStart
    ? new Date(leg.scheduledWindowStart)
    : null;
  const windowEnd = leg.scheduledWindowEnd
    ? new Date(leg.scheduledWindowEnd)
    : null;
  const windowSummary =
    windowStart && windowEnd && formatWindow
      ? formatWindow(windowStart, windowEnd)
      : null;
  return {
    legType,
    shipmentId: leg.id,
    status: leg.status,
    trackingId: leg.trackingId ?? null,
    providerTrackingUrl: leg.providerTrackingUrl ?? null,
    scheduledDate: leg.scheduledDate
      ? new Date(leg.scheduledDate).toISOString()
      : null,
    windowSummary,
    isBooked: RESALE_LEG_BOOKED_STATUSES.has(leg.status),
    isDelivered: leg.status === 'COMPLETED',
  };
}

function buildTimelineFromSteps(
  steps: Array<{
    milestone: string;
    label: string;
    description: string;
    timestamp?: string | null;
  }>,
  activeStep: number,
): ShipmentProgressMilestone[] {
  return steps.map((s, i) => {
    let rowStatus: 'completed' | 'current' | 'pending' = 'pending';
    if (i < activeStep) rowStatus = 'completed';
    else if (i === activeStep) rowStatus = 'current';
    const showTs = rowStatus === 'completed' || rowStatus === 'current';
    return {
      milestone: s.milestone,
      label: s.label,
      description: s.description,
      timestamp: showTs && s.timestamp ? s.timestamp : null,
      status: rowStatus,
    };
  });
}

function percentFromStep(activeStep: number, totalSteps: number): number {
  if (totalSteps <= 1) return activeStep >= totalSteps - 1 ? 100 : 0;
  if (activeStep >= totalSteps - 1) return 100;
  return Math.round((activeStep / (totalSteps - 1)) * 100);
}

function rentalActiveStep(
  deliveryStatus: string,
  returnStatus?: string | null,
): number {
  const ob = String(deliveryStatus ?? '').toUpperCase();
  const ret = returnStatus ? String(returnStatus).toUpperCase() : null;
  if (ret === 'COMPLETED') return 4;
  if (ob === 'COMPLETED') return 3;
  if (ob === 'IN_TRANSIT') return 1;
  if (ob === 'DISPATCHED' || ob === 'DISPATCHING') return 0;
  return 0;
}

function resaleActiveStep(deliveryStatus: string): number {
  const st = String(deliveryStatus ?? '').toUpperCase();
  if (st === 'COMPLETED') return 2;
  if (RESALE_LEG_BOOKED_STATUSES.has(st)) return 1;
  return 0;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function safeListerName(
  listerName: string | null | undefined,
  itemNames: string[],
): string | null {
  const name = listerName?.trim();
  if (!name) return null;
  const itemSet = new Set(itemNames.map((n) => n.trim().toLowerCase()));
  if (itemSet.has(name.toLowerCase())) return null;
  return name;
}

function buildRentalGroup(
  outbound: ResalePackageShipment,
  returnLeg: ResalePackageShipment | undefined,
  items: ResalePackageOrderItem[],
  listerNameById: Map<string, string>,
  formatWindow?: (start: Date, end: Date) => string,
): ShipmentProgressGroup {
  const itemNames = items.map((i) => i.product?.name?.trim() || 'Item');
  const title = itemNames.join(', ');
  const listerId = outbound.listerId ?? null;
  const listerName = safeListerName(
    listerId ? listerNameById.get(listerId) ?? null : null,
    itemNames,
  );

  const rentalSteps = [
    {
      milestone: 'delivery_booked',
      label: 'Delivery booked',
      description: 'Carrier pickup is scheduled for your rental.',
      timestamp: toIsoString(outbound.dispatchedAt),
    },
    {
      milestone: 'delivery_transit',
      label: 'On the way to you',
      description: 'Your rental is in transit.',
      timestamp: null,
    },
    {
      milestone: 'with_you',
      label: 'With you',
      description: 'Rental period is active. Enjoy your rental.',
      timestamp:
        outbound.status === 'COMPLETED'
          ? toIsoString(outbound.updatedAt)
          : null,
    },
    {
      milestone: 'return',
      label: 'Return',
      description:
        'Return the item by the due date. Schedule pickup in the app when ready.',
      timestamp: returnLeg?.scheduledWindowStart
        ? new Date(returnLeg.scheduledWindowStart).toISOString()
        : null,
    },
    {
      milestone: 'returned',
      label: 'Returned',
      description:
        'Item is back with the lister, or they have confirmed receipt.',
      timestamp:
        returnLeg?.status === 'COMPLETED'
          ? toIsoString(returnLeg.updatedAt)
          : null,
    },
  ];

  const activeStep = rentalActiveStep(
    outbound.status,
    returnLeg?.status ?? null,
  );
  const timeline = buildTimelineFromSteps(rentalSteps, activeStep);
  const currentLabel =
    timeline.find((t) => t.status === 'current')?.label ?? 'In progress';

  return {
    id: `rental-${outbound.id}`,
    kind: 'rental',
    title,
    itemNames,
    listerName,
    delivery: legDetail(outbound, 'OUTBOUND', formatWindow),
    return: returnLeg ? legDetail(returnLeg, 'RETURN', formatWindow) : null,
    timeline,
    percentComplete: percentFromStep(activeStep, rentalSteps.length),
    currentLabel,
  };
}

function buildResaleGroup(
  row: ResalePackageRow,
  leg: ResalePackageShipment,
  formatWindow?: (start: Date, end: Date) => string,
): ShipmentProgressGroup {
  const itemNames = row.itemNames;
  const listerName = safeListerName(row.listerName, itemNames);

  const resaleSteps = [
    {
      milestone: 'purchase_booked',
      label: 'Dispatch booked',
      description: 'Seller has booked delivery to your address.',
      timestamp: row.scheduledDate,
    },
    {
      milestone: 'purchase_transit',
      label: 'On the way',
      description: 'Your purchase is in transit.',
      timestamp: null,
    },
    {
      milestone: 'purchase_delivered',
      label: 'Delivered',
      description: 'Confirm receipt when everything matches the listing.',
      timestamp: row.isDelivered ? row.scheduledDate : null,
    },
  ];

  const activeStep = resaleActiveStep(leg.status);
  const timeline = buildTimelineFromSteps(resaleSteps, activeStep);
  const currentLabel =
    timeline.find((t) => t.status === 'current')?.label ?? 'In progress';

  return {
    id: `resale-${leg.id}`,
    kind: 'resale',
    title: row.itemLabel,
    itemNames,
    listerName,
    delivery: legDetail(leg, 'RESALE', formatWindow),
    return: null,
    timeline,
    percentComplete: percentFromStep(activeStep, resaleSteps.length),
    currentLabel,
  };
}

/**
 * Per-package progress: rental = outbound+return pair; each resale leg is separate.
 */
export function buildShipmentProgressOverview(input: {
  orderItems: ResalePackageOrderItem[];
  shipments: ResalePackageShipment[];
  orderStatus: string;
  listerNameById?: Map<string, string>;
  formatWindow?: (start: Date, end: Date) => string;
  orderCreatedAt?: Date | string | null;
}): ShipmentProgressOverview {
  const orderItems = input.orderItems ?? [];
  const shipments = input.shipments ?? [];
  const listerNameById = input.listerNameById ?? new Map();
  const formatWindow = input.formatWindow;

  const groups: ShipmentProgressGroup[] = [];
  const rentalItems = orderItems.filter(isRentalOrderItem);
  const outboundLegs = shipments.filter((s) => s.type === 'OUTBOUND');
  const returnLegs = shipments.filter((s) => s.type === 'RETURN');
  const resaleLegs = shipments.filter((s) => s.type === 'RESALE');

  const usedReturnIds = new Set<string>();

  for (const outbound of outboundLegs) {
    let linked = rentalItems.filter((i) => i.outboundShipmentId === outbound.id);
    if (linked.length === 0 && outbound.listerId) {
      linked = rentalItems.filter(
        (i) => i.product?.curator?.id === outbound.listerId,
      );
    }
    if (linked.length === 0) linked = rentalItems;

    let returnLeg = returnLegs.find((r) =>
      linked.some((i) => i.returnShipmentId === r.id),
    );
    if (!returnLeg && outbound.listerId) {
      returnLeg = returnLegs.find(
        (r) => r.listerId === outbound.listerId && !usedReturnIds.has(r.id),
      );
    }
    if (!returnLeg && returnLegs.length === 1 && outboundLegs.length === 1) {
      returnLeg = returnLegs[0];
    }
    if (returnLeg) usedReturnIds.add(returnLeg.id);

    groups.push(
      buildRentalGroup(outbound, returnLeg, linked, listerNameById, formatWindow),
    );
  }

  if (rentalItems.length > 0 && outboundLegs.length === 0) {
    const rows = buildRentalOutboundPackageRows({
      orderItems,
      shipments,
      listerNameById,
      formatWindow,
    });
    for (const row of rows) {
      const syntheticOutbound: ResalePackageShipment = {
        id: row.shipmentId,
        type: 'OUTBOUND',
        status: row.status,
        listerId: row.listerId,
        trackingId: row.trackingId,
        providerTrackingUrl: row.providerTrackingUrl,
        scheduledDate: row.scheduledDate,
      };
      groups.push(
        buildRentalGroup(
          syntheticOutbound,
          undefined,
          rentalItems,
          listerNameById,
          formatWindow,
        ),
      );
    }
  }

  const resaleRows = buildResalePackageRows({
    orderItems,
    shipments,
    listerNameById,
    formatWindow,
  });
  for (const leg of resaleLegs) {
    const row = resaleRows.find((r) => r.shipmentId === leg.id) ?? {
      shipmentId: leg.id,
      listerId: leg.listerId ?? null,
      listerName: leg.listerId
        ? listerNameById.get(leg.listerId) ?? null
        : null,
      itemLabel:
        orderItems
          .filter(isResalePurchaseOrderItem)
          .map((i) => i.product?.name?.trim())
          .filter(Boolean)
          .join(', ') || 'Purchase',
      itemNames: orderItems
        .filter(isResalePurchaseOrderItem)
        .map((i) => i.product?.name?.trim() || 'Item'),
      status: leg.status,
      scheduledDate: leg.scheduledDate
        ? new Date(leg.scheduledDate).toISOString()
        : null,
      windowSummary: null,
      trackingId: leg.trackingId ?? null,
      providerTrackingUrl: leg.providerTrackingUrl ?? null,
      isDelivered: leg.status === 'COMPLETED',
      isBooked: RESALE_LEG_BOOKED_STATUSES.has(leg.status),
    };
    groups.push(buildResaleGroup(row, leg, formatWindow));
  }

  if (hasResalePurchaseOrderItems(orderItems) && resaleLegs.length === 0) {
    for (const row of resaleRows) {
      groups.push(
        buildResaleGroup(
          row,
          {
            id: row.shipmentId,
            type: 'RESALE',
            status: row.status,
            listerId: row.listerId,
            trackingId: row.trackingId,
            providerTrackingUrl: row.providerTrackingUrl,
            scheduledDate: row.scheduledDate,
          },
          formatWindow,
        ),
      );
    }
  }

  const deliveredGroups = groups.filter((g) => g.percentComplete >= 100).length;
  const overallStep =
    String(input.orderStatus) === OrderStatus.COMPLETED
      ? 2
      : deliveredGroups === groups.length && groups.length > 0
        ? 2
        : groups.some((g) => g.percentComplete > 0)
          ? 1
          : 0;

  const overallSteps = [
    {
      milestone: 'order_placed',
      label: 'Order placed',
      description: 'Your order is confirmed.',
      timestamp: input.orderCreatedAt
        ? new Date(input.orderCreatedAt).toISOString()
        : null,
    },
    {
      milestone: 'fulfilling',
      label: 'Shipments in progress',
      description:
        groups.length > 1
          ? `Tracking ${groups.length} packages separately below.`
          : 'See package progress below.',
      timestamp: null,
    },
    {
      milestone: 'order_complete',
      label: 'Order complete',
      description: 'All packages on this order are finished.',
      timestamp: null,
    },
  ];

  const overallTimeline = buildTimelineFromSteps(overallSteps, overallStep);
  const percentComplete =
    groups.length > 0
      ? Math.round(
          groups.reduce((s, g) => s + g.percentComplete, 0) / groups.length,
        )
      : percentFromStep(overallStep, overallSteps.length);

  const summaryLabel =
    groups.length === 0
      ? 'No shipments yet'
      : groups.length === 1
        ? groups[0].currentLabel
        : `${deliveredGroups} of ${groups.length} packages complete`;

  return {
    percentComplete,
    summaryLabel,
    timeline: overallTimeline,
    groups,
  };
}

function hasResalePurchaseOrderItems(items: ResalePackageOrderItem[]): boolean {
  return items.some(isResalePurchaseOrderItem);
}
