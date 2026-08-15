import {
  canBuyerConfirmRentalReceipt,
  canConfirmRentalShipment,
  canRenterRaiseRentalDeliveryDispute,
  getRentalInspectionHours,
  isRentalShipmentWithinInspectionWindow,
  listConfirmableRentalShipments,
  shouldActivateRentalAfterOutboundConfirm,
} from './rental-delivery.util';

describe('rental-delivery.util', () => {
  const rentalItem = {
    days: 3,
    product: { listingType: 'RENTAL' as const },
  };

  it('defaults inspection window to 1 hour', () => {
    expect(getRentalInspectionHours()).toBe(1);
  });

  it('allows confirm after OUTBOUND leg delivered', () => {
    expect(
      canBuyerConfirmRentalReceipt({
        listingType: 'RENTAL',
        status: 'DELIVERED',
        orderItems: [rentalItem],
        shipments: [{ id: 's1', type: 'OUTBOUND', status: 'COMPLETED' }],
      }),
    ).toBe(true);
    expect(
      listConfirmableRentalShipments([
        { id: 's1', type: 'OUTBOUND', status: 'COMPLETED' },
      ]),
    ).toHaveLength(1);
  });

  it('blocks re-confirm on already confirmed shipment', () => {
    expect(
      canConfirmRentalShipment({
        type: 'OUTBOUND',
        status: 'COMPLETED',
        buyerConfirmedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('activates rental when all outbound legs are confirmed', () => {
    expect(
      shouldActivateRentalAfterOutboundConfirm({
        orderItems: [rentalItem],
        shipments: [
          {
            id: 'o1',
            type: 'OUTBOUND',
            status: 'COMPLETED',
            buyerConfirmedAt: new Date(),
          },
        ],
      }),
    ).toBe(true);
  });

  it('blocks delivery dispute after inspection window', () => {
    const oldDelivery = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(
      isRentalShipmentWithinInspectionWindow(
        {
          type: 'OUTBOUND',
          status: 'COMPLETED',
          updatedAt: oldDelivery,
        },
        new Date(),
      ),
    ).toBe(false);
    expect(
      canRenterRaiseRentalDeliveryDispute({
        listingType: 'RENTAL',
        status: 'DELIVERED',
        orderItems: [rentalItem],
        shipments: [
          {
            type: 'OUTBOUND',
            status: 'COMPLETED',
            updatedAt: oldDelivery,
          },
        ],
      }),
    ).toBe(false);
  });
});
