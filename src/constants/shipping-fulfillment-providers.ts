/** Topship (existing): city-based quotes and GraphQL booking. */
export const FULFILLMENT_TOPSHIP = 'topship';

/** Chowdeck Relay direct API: string-address fee quote and REST booking. */
export const FULFILLMENT_CHOWDECK_RELAY = 'chowdeck_relay';

/**
 * Comma-separated env `SHIPPING_FULFILLMENT_PROVIDERS` (case-insensitive).
 * Examples: `topship` (default), `chowdeck_relay`, `topship,chowdeck_relay`.
 */
export function parseShippingFulfillmentProviders(): Set<string> {
  const raw = process.env.SHIPPING_FULFILLMENT_PROVIDERS?.trim();
  if (!raw) {
    return new Set([FULFILLMENT_TOPSHIP]);
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts.length ? parts : [FULFILLMENT_TOPSHIP]);
}

export function topshipFulfillmentEnabled(): boolean {
  return parseShippingFulfillmentProviders().has(FULFILLMENT_TOPSHIP);
}

export function chowdeckRelayFulfillmentEnabled(): boolean {
  return parseShippingFulfillmentProviders().has(FULFILLMENT_CHOWDECK_RELAY);
}

export function chowdeckRelayApiConfigured(): boolean {
  return Boolean(process.env.CHOWDECK_API_KEY?.trim());
}

/** Relay quotes and dispatch require the API key. */
export function chowdeckRelayQuotesAvailable(): boolean {
  return chowdeckRelayFulfillmentEnabled() && chowdeckRelayApiConfigured();
}
