import {
  resolveShipmentFulfillmentProvider,
  resolveShipmentTrackingForEmail,
  guessExternalTrackingUrlFromReference,
  buildShippingEmailTrackingFields,
} from './shipment-tracking-url.util';

describe('shipment-tracking-url.util', () => {
  it('detects shipbubble from pricing tier', () => {
    expect(resolveShipmentFulfillmentProvider('shipbubble:gokada')).toBe(
      'shipbubble',
    );
    expect(resolveShipmentFulfillmentProvider('chowdeck_relay')).toBe(
      'chowdeck_relay',
    );
    expect(resolveShipmentFulfillmentProvider('glovo')).toBe('topship');
  });

  it('uses stored providerTrackingUrl when present', () => {
    const r = resolveShipmentTrackingForEmail({
      pricingTier: 'shipbubble:gokada',
      providerTrackingUrl: 'https://track.example/abc',
      trackingId: 'SB-123',
    });
    expect(r.trackingUrl).toBe('https://track.example/abc');
    expect(r.trackingProviderLabel).toBe('Shipbubble');
  });

  it('falls back to Shipbubble portal for shipbubble tiers without stored URL', () => {
    const r = resolveShipmentTrackingForEmail({
      pricingTier: 'shipbubble',
      trackingId: 'SB-498BEFDDB0F6',
      providerShipmentId: 'ord-99',
    });
    expect(r.trackingUrl).toContain('trackshipment.shipbubble.com');
    expect(r.trackingUrl).toContain('order_id=ord-99');
    expect(r.trackingProviderLabel).toBe('Shipbubble');
  });

  it('falls back to Topship portal for topship tiers', () => {
    const r = resolveShipmentTrackingForEmail({
      pricingTier: 'glovo',
      trackingId: 'TS-123',
    });
    expect(r.trackingUrl).toContain('ship.topship.africa');
    expect(r.trackingProviderLabel).toBe('Topship');
  });

  it('guesses Shipbubble from SB- tracking prefix', () => {
    expect(guessExternalTrackingUrlFromReference('SB-ABC')).toContain(
      'trackshipment.shipbubble.com',
    );
    expect(guessExternalTrackingUrlFromReference('TS-1')).toContain(
      'ship.topship.africa',
    );
  });

  it('prioritizes admin-provided tracking URL over default Topship', () => {
    const result = buildShippingEmailTrackingFields(
      {
        pricingTier: 'glovo',
        trackingId: 'RIDER-123',
        providerTrackingUrl: null,
      },
      { trackingUrl: 'https://custom-tracker.com/ride/123' },
    );
    expect(result.trackingUrl).toBe('https://custom-tracker.com/ride/123');
    expect(result.trackingNumber).toBe('RIDER-123');
  });

  it('prioritizes stored providerTrackingUrl over default Topship', () => {
    const result = buildShippingEmailTrackingFields(
      {
        pricingTier: 'glovo',
        trackingId: 'RIDER-123',
        providerTrackingUrl: 'https://stored-custom.com/track/abc',
      },
      {},
    );
    expect(result.trackingUrl).toBe('https://stored-custom.com/track/abc');
    expect(result.trackingNumber).toBe('RIDER-123');
  });
});
