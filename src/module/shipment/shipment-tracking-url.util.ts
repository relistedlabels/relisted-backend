import { isShipbubblePricingTier } from 'src/services/shipbubble/shipbubble.service';

export const TOPSHIP_TRACKING_PAGE_URL = 'https://ship.topship.africa/tracking';
export const SHIPBUBBLE_TRACKING_PAGE_URL = 'https://trackshipment.shipbubble.com/';

export type ShipmentFulfillmentProvider =
  | 'topship'
  | 'shipbubble'
  | 'chowdeck_relay';

export type ShipmentTrackingEmailSource = {
  pricingTier?: string | null;
  providerTrackingUrl?: string | null;
  trackingId?: string | null;
  providerShipmentId?: string | null;
};

export type ResolvedShipmentTracking = {
  trackingUrl?: string;
  trackingProviderLabel: string;
  fulfillmentProvider: ShipmentFulfillmentProvider;
};

/** Persisted `Shipment.pricingTier` → fulfillment backend used at dispatch. */
export function resolveShipmentFulfillmentProvider(
  pricingTier: string | null | undefined,
): ShipmentFulfillmentProvider {
  const tier = String(pricingTier ?? '').trim().toLowerCase();
  if (isShipbubblePricingTier(tier)) return 'shipbubble';
  if (tier === 'chowdeck_relay') return 'chowdeck_relay';
  return 'topship';
}

export function getShippingProviderDisplayName(
  provider: ShipmentFulfillmentProvider,
): string {
  switch (provider) {
    case 'shipbubble':
      return 'Shipbubble';
    case 'chowdeck_relay':
      return 'Chowdeck Relay';
    case 'topship':
    default:
      return 'Topship';
  }
}

/**
 * Customer-facing tracking link for emails and in-app copy.
 * Prefers `providerTrackingUrl` from dispatch/webhooks; otherwise provider defaults.
 */
export function resolveShipmentTrackingForEmail(
  source: ShipmentTrackingEmailSource,
): ResolvedShipmentTracking {
  const fulfillmentProvider = resolveShipmentFulfillmentProvider(
    source.pricingTier,
  );
  const trackingProviderLabel =
    getShippingProviderDisplayName(fulfillmentProvider);

  const stored = source.providerTrackingUrl?.trim();
  if (stored) {
    return { trackingUrl: stored, trackingProviderLabel, fulfillmentProvider };
  }

  const trackingId = source.trackingId?.trim();
  const providerShipmentId = source.providerShipmentId?.trim();

  if (fulfillmentProvider === 'shipbubble') {
    if (providerShipmentId) {
      return {
        trackingUrl: `${SHIPBUBBLE_TRACKING_PAGE_URL}?order_id=${encodeURIComponent(providerShipmentId)}`,
        trackingProviderLabel,
        fulfillmentProvider,
      };
    }
    return {
      trackingUrl: SHIPBUBBLE_TRACKING_PAGE_URL,
      trackingProviderLabel,
      fulfillmentProvider,
    };
  }

  if (fulfillmentProvider === 'topship') {
    if (trackingId) {
      return {
        trackingUrl: `${TOPSHIP_TRACKING_PAGE_URL}/${encodeURIComponent(trackingId)}`,
        trackingProviderLabel,
        fulfillmentProvider,
      };
    }
    return {
      trackingUrl: TOPSHIP_TRACKING_PAGE_URL,
      trackingProviderLabel,
      fulfillmentProvider,
    };
  }

  // Chowdeck Relay: tracking URL comes from the provider response when available.
  return { trackingProviderLabel, fulfillmentProvider };
}

/** Merge resolved tracking fields into shipping-update / lister email payloads. */
export function buildShippingEmailTrackingFields(
  source: ShipmentTrackingEmailSource,
  overrides?: { trackingNumber?: string; trackingUrl?: string },
): {
  trackingNumber?: string;
  trackingUrl?: string;
  trackingProviderLabel: string;
} {
  const resolved = resolveShipmentTrackingForEmail(source);
  return {
    trackingNumber:
      overrides?.trackingNumber ?? source.trackingId?.trim() ?? undefined,
    trackingUrl: overrides?.trackingUrl ?? resolved.trackingUrl,
    trackingProviderLabel: resolved.trackingProviderLabel,
  };
}

/** Guess carrier portal from a bare tracking reference (e.g. lister manual entry). */
export function guessExternalTrackingUrlFromReference(
  trackingNumber: string,
): string | null {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return null;
  if (/^SB-/i.test(trimmed)) {
    return SHIPBUBBLE_TRACKING_PAGE_URL;
  }
  return `${TOPSHIP_TRACKING_PAGE_URL}/${encodeURIComponent(trimmed)}`;
}
