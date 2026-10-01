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
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-24T11:00:00.000Z')); // midday Lagos

    try {
      expect(
        resolveShipbubbleSameDayOnly({
          shipmentType: 'RETURN',
          scheduledWindowStart: new Date('2026-09-25T14:00:00.000Z'),
        }),
      ).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('filters to same-day couriers for return legs scheduled today', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-24T11:00:00.000Z')); // midday Lagos

    try {
      expect(
        resolveShipbubbleSameDayOnly({
          shipmentType: 'RETURN',
          scheduledWindowStart: new Date('2026-09-24T14:00:00.000Z'),
        }),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
