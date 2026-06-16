import { Prisma } from '@prisma/client';

export const FULFILLMENT_PROVIDER_FILTERS = [
  'manual',
  'topship',
  'shipbubble',
  'chowdeck_relay',
] as const;

export type FulfillmentProviderFilter =
  (typeof FULFILLMENT_PROVIDER_FILTERS)[number];

/** Maps list/costs query values to a shipment `where` clause. */
export function parseFulfillmentProviderFilter(
  raw?: string | null,
): FulfillmentProviderFilter | undefined {
  const p = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!p || p === 'all') return undefined;
  if (p === 'automated') return 'topship';
  if (
    (FULFILLMENT_PROVIDER_FILTERS as readonly string[]).includes(p)
  ) {
    return p as FulfillmentProviderFilter;
  }
  return undefined;
}

export function shipmentWhereForFulfillmentProvider(
  provider: FulfillmentProviderFilter,
): Prisma.ShipmentWhereInput {
  if (provider === 'manual') {
    return { manualFulfillment: true };
  }
  if (provider === 'shipbubble') {
    return {
      manualFulfillment: false,
      OR: [
        { pricingTier: 'shipbubble' },
        { pricingTier: { startsWith: 'shipbubble:' } },
      ],
    };
  }
  if (provider === 'chowdeck_relay') {
    return {
      manualFulfillment: false,
      pricingTier: 'chowdeck_relay',
    };
  }
  return {
    manualFulfillment: false,
    NOT: {
      OR: [
        { pricingTier: 'shipbubble' },
        { pricingTier: { startsWith: 'shipbubble:' } },
        { pricingTier: 'chowdeck_relay' },
      ],
    },
  };
}
