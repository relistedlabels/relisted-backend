import type { ShipmentType } from '@prisma/client';

/** Human-readable label for a shipment leg in admin emails and notifications. */
export function shipmentLegLabel(type: ShipmentType | string): string {
  switch (type) {
    case 'OUTBOUND':
      return 'Rental delivery (to renter)';
    case 'RETURN':
      return 'Return (to lister)';
    case 'RESALE':
      return 'Purchase delivery';
    default:
      return 'Shipment';
  }
}
