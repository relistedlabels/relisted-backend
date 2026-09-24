import {
  parseShipbubblePricingTier,
  resolveShipbubbleSameDayOnly,
  shipbubblePricingTierSlug,
} from './shipbubble.service';

describe('shipbubble pricing tier slugs', () => {
  it('keeps distinct tiers when service_code matches but courier_id differs', () => {
    expect(shipbubblePricingTierSlug('routelift', 'same-day')).toBe(
      'shipbubble:routelift:same-day',
    );
    expect(shipbubblePricingTierSlug('routelift', 'economy')).toBe(
      'shipbubble:routelift:economy',
    );
  });

  it('parses service_code from extended tier slugs', () => {
    expect(parseShipbubblePricingTier('shipbubble:routelift:same-day')).toEqual({
      serviceCode: 'routelift',
    });
  });
});

describe('resolveShipbubbleSameDayOnly', () => {
  it('allows multi-day couriers for return legs on a future Lagos day', () => {
    const future = new Date('2026-09-30T07:00:00.000Z');
    expect(
      resolveShipbubbleSameDayOnly({
        shipmentType: 'RETURN',
        scheduledWindowStart: future,
      }),
    ).toBe(false);
  });

  it('filters to same-day couriers for return legs scheduled today', () => {
    const todayWindow = new Date();
    todayWindow.setHours(todayWindow.getHours() + 2, 0, 0, 0);
    expect(
      resolveShipbubbleSameDayOnly({
        shipmentType: 'RETURN',
        scheduledWindowStart: todayWindow,
      }),
    ).toBe(true);
  });
});
