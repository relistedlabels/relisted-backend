import { isShipbubblePricingTier } from 'src/services/shipbubble/shipbubble.service';

export type ShipmentLifecycleStatus =
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'CANCELLED';

export type MappedProviderShipmentStatus = ShipmentLifecycleStatus | null;

export const SHIPMENT_STATUS_ADVANCE_ORDER: ShipmentLifecycleStatus[] = [
  'DISPATCHED',
  'IN_TRANSIT',
  'COMPLETED',
];

/** Normalize provider status strings for map lookup (e.g. "In-Transit" → "intransit"). */
export function normalizeProviderStatus(status: string): string {
  return status.toLowerCase().replace(/[^a-z]/g, '');
}

const TOPSHIP_AND_SHARED_STATUS_MAP: Record<
  string,
  MappedProviderShipmentStatus
> = {
  pickedup: 'IN_TRANSIT',
  intransit: 'IN_TRANSIT',
  delivered: 'COMPLETED',
  received: 'COMPLETED',
  confirmed: 'DISPATCHED',
  draft: null,
  cancelled: 'CANCELLED',
  awaitingpickup: 'DISPATCHED',
  awaitingpickuppending: 'DISPATCHED',
  awaitingdropoff: 'DISPATCHED',
  deliveryinprogress: 'IN_TRANSIT',
  assignedfordelivery: 'IN_TRANSIT',
  pendingconfirmation: null,
  clarificationneeded: null,
  receivedathub: 'IN_TRANSIT',
  arrivednigeria: 'IN_TRANSIT',
  pickupinprogress: 'IN_TRANSIT',
  shipmentprocessing: 'DISPATCHED',
  deliveryfailed: 'CANCELLED',
  cancellationpending: 'CANCELLED',
  paymentpending: null,
  pickupfailed: 'CANCELLED',
  riderassigned: 'IN_TRANSIT',
  preparing: 'DISPATCHED',
  success: 'COMPLETED',
  rejected: 'CANCELLED',
};

const SHIPBUBBLE_STATUS_MAP: Record<string, MappedProviderShipmentStatus> = {
  pending: 'DISPATCHED',
  processing: 'DISPATCHED',
  confirmed: 'DISPATCHED',
  pickedup: 'IN_TRANSIT',
  intransit: 'IN_TRANSIT',
  picked_up: 'IN_TRANSIT',
  outfordelivery: 'IN_TRANSIT',
  completed: 'COMPLETED',
  delivered: 'COMPLETED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
};

export function mapProviderStatusToShipmentStatus(
  providerStatus: string,
  pricingTier: string | null | undefined,
): MappedProviderShipmentStatus | undefined {
  const normalized = normalizeProviderStatus(providerStatus);
  if (!normalized) return undefined;

  const shared = TOPSHIP_AND_SHARED_STATUS_MAP[normalized];
  if (shared !== undefined) {
    return shared;
  }

  if (isShipbubblePricingTier(pricingTier)) {
    const shipbubble = SHIPBUBBLE_STATUS_MAP[normalized];
    if (shipbubble !== undefined) {
      return shipbubble;
    }
  }

  return undefined;
}

/** Forward-only progression; polling and webhooks share this rule to avoid fighting each other. */
export function canAdvanceShipmentStatus(
  currentStatus: string,
  mappedStatus: ShipmentLifecycleStatus,
): boolean {
  if (mappedStatus === 'CANCELLED') {
    return currentStatus !== 'COMPLETED' && currentStatus !== 'CANCELLED';
  }

  const currentIndex = SHIPMENT_STATUS_ADVANCE_ORDER.indexOf(
    currentStatus as ShipmentLifecycleStatus,
  );
  const newIndex = SHIPMENT_STATUS_ADVANCE_ORDER.indexOf(mappedStatus);
  if (newIndex < 0) return false;
  if (currentIndex < 0) return true;
  return newIndex > currentIndex;
}

export function shipbubbleWebhookEventImpliesCancellation(event: string): boolean {
  return normalizeProviderStatus(event) === 'shipmentcancelled';
}
