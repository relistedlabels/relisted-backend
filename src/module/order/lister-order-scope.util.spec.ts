import {
  isResalePurchaseLine,
  listerOrderListingTypeFromItems,
  orderItemsForListerWhere,
} from './lister-order-scope.util';

describe('lister-order-scope.util', () => {
  it('orderItemsForListerWhere matches product curator and resale shipment lister', () => {
    const w = orderItemsForListerWhere('lister-a');
    expect(w.OR).toEqual(
      expect.arrayContaining([
        { product: { curatorId: 'lister-a' } },
        { resaleShipment: { listerId: 'lister-a' } },
      ]),
    );
  });

  it('derives RESALE when lister only has resale lines', () => {
    expect(
      listerOrderListingTypeFromItems([
        {
          days: 0,
          product: { listingType: 'RENT_OR_RESALE' },
        },
      ]),
    ).toBe('RESALE');
  });

  it('derives RENTAL when lister only has rental lines on a mixed checkout order', () => {
    expect(
      listerOrderListingTypeFromItems([
        { days: 3, product: { listingType: 'RENTAL' } },
      ]),
    ).toBe('RENTAL');
  });

  it('isResalePurchaseLine requires days === 0 for RENT_OR_RESALE', () => {
    expect(
      isResalePurchaseLine({
        days: 3,
        product: { listingType: 'RENT_OR_RESALE' },
      }),
    ).toBe(false);
  });
});
