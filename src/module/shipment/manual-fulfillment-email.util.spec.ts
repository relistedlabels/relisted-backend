import {
  formatManualShipmentWindow,
  productNamesFromManualShipment,
} from './manual-fulfillment-email.util';

describe('manual-fulfillment-email.util', () => {
  it('collects outbound product names without duplicates', () => {
    const names = productNamesFromManualShipment({
      type: 'OUTBOUND',
      orderItemsOutbound: [
        { product: { name: 'Blue dress' } },
        { product: { name: 'Blue dress' } },
      ],
      orderItemsReturn: [],
      orderItemsResale: [],
    });
    expect(names).toEqual(['Blue dress']);
  });

  it('formats a dispatch window in Lagos time', () => {
    const label = formatManualShipmentWindow({
      scheduledWindowStart: new Date('2026-06-10T09:00:00+01:00'),
      scheduledWindowEnd: new Date('2026-06-10T14:00:00+01:00'),
      scheduledDate: new Date('2026-06-10T00:00:00+01:00'),
    });
    expect(label).toContain('June');
    expect(label).toContain('9 am');
    expect(label).toContain('2 pm');
  });
});
