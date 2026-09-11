/** Topship (existing): city-based quotes and GraphQL booking. */
export const FULFILLMENT_TOPSHIP = 'topship';

/** Chowdeck Relay direct API: string-address fee quote and REST booking. */
export const FULFILLMENT_CHOWDECK_RELAY = 'chowdeck_relay';

/** Shipbubble: verified addresses, fetch_rates, and label booking. */
export const FULFILLMENT_SHIPBUBBLE = 'shipbubble';

/** Terminal Africa T-Ship: multi-carrier quotes and pickup booking. */
export const FULFILLMENT_TSHIP = 'tship';

/**
 * Comma-separated env `SHIPPING_FULFILLMENT_PROVIDERS` (case-insensitive).
 * Examples: `topship` (default), `chowdeck_relay`, `shipbubble`, `topship,chowdeck_relay,shipbubble`.
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

export function topshipApiConfigured(): boolean {
  return Boolean(process.env.TOPSHIP_API_KEY?.trim());
}

/** Admin shipment rate preview (rebook / dispatch validation). */
export function topshipAdminQuotesAvailable(): boolean {
  return topshipFulfillmentEnabled() && topshipApiConfigured();
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

export function shipbubbleFulfillmentEnabled(): boolean {
  return parseShippingFulfillmentProviders().has(FULFILLMENT_SHIPBUBBLE);
}

export function shipbubbleApiConfigured(): boolean {
  return Boolean(process.env.SHIPBUBBLE_API_KEY?.trim());
}

export function shipbubbleQuotesAvailable(): boolean {
  return shipbubbleFulfillmentEnabled() && shipbubbleApiConfigured();
}

export function tshipFulfillmentEnabled(): boolean {
  return parseShippingFulfillmentProviders().has(FULFILLMENT_TSHIP);
}

export function tshipApiConfigured(): boolean {
  return Boolean(process.env.TERMINAL_API_KEY?.trim());
}

export function tshipQuotesAvailable(): boolean {
  return tshipFulfillmentEnabled() && tshipApiConfigured();
}
