import {
  formatDispatchWindowCompact,
  formatRentalBoundaryDateLagos,
} from './dispatch-window-format';

type ManualShipmentProductRow = {
  type: string;
  orderItemsOutbound: Array<{ product: { name: string } }>;
  orderItemsReturn: Array<{ product: { name: string } }>;
  orderItemsResale: Array<{ product: { name: string } }>;
};

type ManualShipmentWindowRow = {
  scheduledWindowStart: Date | null;
  scheduledWindowEnd: Date | null;
  scheduledDate: Date;
};

export function productNamesFromManualShipment(
  shipment: ManualShipmentProductRow,
): string[] {
  const items =
    shipment.type === 'OUTBOUND'
      ? shipment.orderItemsOutbound
      : shipment.type === 'RETURN'
        ? shipment.orderItemsReturn
        : shipment.orderItemsResale;
  const names = items
    .map((row) => row.product?.name?.trim())
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

export function formatManualShipmentWindow(
  shipment: ManualShipmentWindowRow,
): string {
  if (shipment.scheduledWindowStart && shipment.scheduledWindowEnd) {
    return formatDispatchWindowCompact(
      shipment.scheduledWindowStart,
      shipment.scheduledWindowEnd,
    );
  }
  return formatRentalBoundaryDateLagos(shipment.scheduledDate);
}

export const manualFulfillmentShipmentEmailSelect = {
  id: true,
  type: true,
  scheduledWindowStart: true,
  scheduledWindowEnd: true,
  scheduledDate: true,
  deliveryLocation: true,
  orderItemsOutbound: { select: { product: { select: { name: true } } } },
  orderItemsReturn: { select: { product: { select: { name: true } } } },
  orderItemsResale: { select: { product: { select: { name: true } } } },
  order: {
    select: {
      user: { select: { name: true, email: true } },
    },
  },
} as const;
