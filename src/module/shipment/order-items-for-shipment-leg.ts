import type { ShipmentType } from '@prisma/client';

/**
 * Order items linked to a checkout shipment leg (see OrderItem outbound / return / resale FKs).
 */
export function selectOrderItemsForShipmentLeg<
  T extends {
    outboundShipmentId?: string | null;
    returnShipmentId?: string | null;
    resaleShipmentId?: string | null;
  },
>(shipmentId: string, legType: ShipmentType, items: T[]): T[] {
  return items.filter((item) => {
    switch (legType) {
      case 'OUTBOUND':
        return item.outboundShipmentId === shipmentId;
      case 'RETURN':
        return item.returnShipmentId === shipmentId;
      case 'RESALE':
        return item.resaleShipmentId === shipmentId;
      default:
        return false;
    }
  });
}
