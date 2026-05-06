/** Checkout label and POST-back `pricingTier` when Topship returns no quote (Relisted fulfills manually). */
export const RELISTED_DISPATCH_SHIPPING_LABEL = 'Relisted dispatch';

/** Flat per-leg shipment charge in kobo when no carrier quote. */
export const RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO = 800_000;

export function isRelistedDispatchShippingTier(
  tier: string | null | undefined,
): boolean {
  return (
    String(tier ?? '').trim().toLowerCase() ===
    RELISTED_DISPATCH_SHIPPING_LABEL.toLowerCase()
  );
}
