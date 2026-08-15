import { resolveRequiredDispatchWindowTypes } from './cart-item-dispatch-windows.util';

describe('resolveRequiredDispatchWindowTypes', () => {
  it('requires OUTBOUND and RETURN for rental lines', () => {
    expect(
      resolveRequiredDispatchWindowTypes({
        days: 3,
        product: { listingType: 'RENTAL' },
      }),
    ).toEqual(['OUTBOUND', 'RETURN']);
  });

  it('requires RESALE for zero-day resale lines', () => {
    expect(
      resolveRequiredDispatchWindowTypes({
        days: 0,
        product: { listingType: 'RESALE' },
      }),
    ).toEqual(['RESALE']);
  });

  it('requires all three window types for rent-or-resale when days > 0', () => {
    expect(
      resolveRequiredDispatchWindowTypes({
        days: 5,
        product: { listingType: 'RENT_OR_RESALE' },
      }),
    ).toEqual(['OUTBOUND', 'RETURN']);
  });

  it('requires RESALE only for rent-or-resale purchase (days 0)', () => {
    expect(
      resolveRequiredDispatchWindowTypes({
        days: 0,
        product: { listingType: 'RENT_OR_RESALE' },
      }),
    ).toEqual(['RESALE']);
  });

  it('returns empty when listing type does not match days', () => {
    expect(
      resolveRequiredDispatchWindowTypes({
        days: 0,
        product: { listingType: 'RENTAL' },
      }),
    ).toEqual([]);
    expect(
      resolveRequiredDispatchWindowTypes({
        days: 3,
        product: { listingType: 'RESALE' },
      }),
    ).toEqual([]);
  });
});
