import {
  buildRenterCheckoutEmailLinesFromCheckout,
  buildRenterCheckoutEmailLinesFromOrder,
} from './renter-checkout-confirmation-email.util';

describe('renter-checkout-confirmation-email.util', () => {
  it('builds rental lines with period and dispatch windows from checkout data', () => {
    const start = new Date('2026-06-10T09:00:00+01:00');
    const end = new Date('2026-06-13T09:00:00+01:00');
    const obStart = new Date('2026-06-09T10:00:00+01:00');
    const obEnd = new Date('2026-06-09T14:00:00+01:00');
    const retStart = new Date('2026-06-13T10:00:00+01:00');
    const retEnd = new Date('2026-06-13T14:00:00+01:00');

    const lines = buildRenterCheckoutEmailLinesFromCheckout(
      [
        {
          id: 'ci-1',
          days: 3,
          startDate: start,
          endDate: end,
          product: {
            name: 'Silk dress',
            listingType: 'RENTAL',
            attachments: {
              uploads: [{ url: 'https://cdn.example.com/dress.jpg', displayOrder: 0 }],
            },
          },
        },
      ],
      [
        {
          bucketMode: 'RENTAL',
          outboundWindow: { start: obStart, end: obEnd },
          returnWindow: { start: retStart, end: retEnd },
          items: [{ id: 'ci-1' }],
        },
      ],
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      productName: 'Silk dress',
      imageUrl: 'https://cdn.example.com/dress.jpg',
      lineType: 'rental',
      days: 3,
    });
    expect(lines[0].rentalPeriodText).toBe('10th–13th June');
    expect(lines[0].rentalPeriodText).not.toMatch(/Wed/);
    expect(lines[0].rentalDeliveryWindowText).toBeTruthy();
    expect(lines[0].returnPickupWindowText).toBeTruthy();
  });

  it('builds purchase lines from persisted order items', () => {
    const lines = buildRenterCheckoutEmailLinesFromOrder(
      [
        {
          days: 0,
          imageUrl: 'https://cdn.example.com/blazer.jpg',
          product: { name: 'Blazer', listingType: 'RESALE' },
          resaleShipment: {
            scheduledWindowStart: new Date('2026-06-15T10:00:00+01:00'),
            scheduledWindowEnd: new Date('2026-06-15T14:00:00+01:00'),
          },
        },
      ],
      [],
    );

    expect(lines).toEqual([
      expect.objectContaining({
        productName: 'Blazer',
        imageUrl: 'https://cdn.example.com/blazer.jpg',
        lineType: 'purchase',
        purchaseDeliveryWindowText: expect.any(String),
      }),
    ]);
  });
});
