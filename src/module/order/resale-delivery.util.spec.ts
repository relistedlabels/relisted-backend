import {
  areResaleShipmentLegsDelivered,
  buildResalePackageRows,
  canBuyerConfirmResaleReceipt,
  canConfirmResaleShipment,
  computeResaleMilestoneStep,
  listConfirmableResaleShipments,
  orderHasResalePurchaseItems,
  resaleLinePriceNgn,
  resaleProgressPercent,
  shouldCompleteOrderAfterResaleFlow,
} from './resale-delivery.util';

describe('resale-delivery.util', () => {
  const resaleItem = {
    days: 0,
    product: { listingType: 'RESALE' as const },
  };

  it('detects resale purchase lines', () => {
    expect(orderHasResalePurchaseItems([resaleItem])).toBe(true);
    expect(
      orderHasResalePurchaseItems([
        { days: 3, product: { listingType: 'RENTAL' } },
      ]),
    ).toBe(false);
  });

  it('requires all RESALE legs COMPLETED', () => {
    expect(
      areResaleShipmentLegsDelivered([
        { type: 'RESALE', status: 'COMPLETED' },
        { type: 'RESALE', status: 'DISPATCHED' },
      ]),
    ).toBe(false);
    expect(
      areResaleShipmentLegsDelivered([
        { type: 'RESALE', status: 'COMPLETED' },
      ]),
    ).toBe(true);
  });

  it('falls back to order DELIVERED when no RESALE legs', () => {
    expect(
      areResaleShipmentLegsDelivered([], {
        status: 'DELIVERED',
        deliveredAt: null,
      }),
    ).toBe(true);
  });

  it('blocks confirm before delivery', () => {
    expect(
      canBuyerConfirmResaleReceipt({
        listingType: 'RESALE',
        status: 'IN_TRANSIT',
        orderItems: [resaleItem],
        shipments: [{ type: 'RESALE', status: 'DISPATCHED' }],
      }),
    ).toBe(false);
  });

  it('allows confirm after RESALE leg delivered', () => {
    expect(
      canBuyerConfirmResaleReceipt({
        listingType: 'RESALE',
        status: 'DELIVERED',
        orderItems: [resaleItem],
        shipments: [{ id: 's1', type: 'RESALE', status: 'COMPLETED' }],
      }),
    ).toBe(true);
    expect(
      listConfirmableResaleShipments([
        { id: 's1', type: 'RESALE', status: 'COMPLETED' },
      ]),
    ).toHaveLength(1);
  });

  it('does not complete mixed order until rental return is done', () => {
    expect(
      shouldCompleteOrderAfterResaleFlow({
        orderItems: [
          { days: 3, product: { listingType: 'RENT_OR_RESALE' } },
          { days: 0, product: { listingType: 'RENT_OR_RESALE' } },
        ],
        shipments: [
          { id: 'r1', type: 'RESALE', status: 'COMPLETED', buyerConfirmedAt: new Date() },
          { type: 'OUTBOUND', status: 'IN_TRANSIT' },
          { type: 'RETURN', status: 'PENDING' },
        ],
        orderStatus: 'IN_TRANSIT',
      }),
    ).toBe(false);
  });

  it('completes when all resale confirmed and rental returned', () => {
    expect(
      shouldCompleteOrderAfterResaleFlow({
        orderItems: [
          { days: 3, product: { listingType: 'RENT_OR_RESALE' } },
          { days: 0, product: { listingType: 'RENT_OR_RESALE' } },
        ],
        shipments: [
          { id: 'r1', type: 'RESALE', status: 'COMPLETED', buyerConfirmedAt: new Date() },
          { type: 'OUTBOUND', status: 'COMPLETED' },
          { type: 'RETURN', status: 'COMPLETED' },
        ],
        orderStatus: 'RETURNED',
      }),
    ).toBe(true);
  });

  it('blocks re-confirm on already confirmed shipment', () => {
    expect(
      canConfirmResaleShipment({
        type: 'RESALE',
        status: 'COMPLETED',
        buyerConfirmedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('allows confirm when RESALE leg is completed even if order is still IN_TRANSIT', () => {
    expect(
      canBuyerConfirmResaleReceipt({
        listingType: 'RESALE',
        status: 'IN_TRANSIT',
        orderItems: [resaleItem],
        shipments: [{ type: 'RESALE', status: 'COMPLETED' }],
      }),
    ).toBe(true);
  });

  it('milestone step stays in transit when only some legs are delivered', () => {
    expect(
      computeResaleMilestoneStep(
        [
          { type: 'RESALE', status: 'COMPLETED' },
          { type: 'RESALE', status: 'IN_TRANSIT' },
        ],
        'IN_TRANSIT',
      ),
    ).toBe(1);
  });

  it('progress percent is not 100 until order completed', () => {
    expect(resaleProgressPercent(2, 4)).toBe(67);
    expect(resaleProgressPercent(3, 4)).toBe(100);
  });

  it('uses product name on package rows', () => {
    const rows = buildResalePackageRows({
      orderItems: [
        {
          productId: 'p1',
          days: 0,
          resaleListerAmount: 45000,
          product: { name: 'Silk Dress', listingType: 'RESALE' },
        },
      ],
      shipments: [
        {
          id: 's1',
          type: 'RESALE',
          status: 'COMPLETED',
          trackingId: 'SB-123',
        },
      ],
    });
    expect(rows[0].itemLabel).toBe('Silk Dress');
    expect(rows[0].trackingId).toBe('SB-123');
  });

  it('reads resale price from order line', () => {
    expect(
      resaleLinePriceNgn({
        days: 0,
        resaleListerAmount: 12000,
        product: { listingType: 'RESALE', resalePrice: 10000 },
      }),
    ).toBe(12000);
  });
});
