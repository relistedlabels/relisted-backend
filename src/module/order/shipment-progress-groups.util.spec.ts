import { OrderStatus } from '@prisma/client';
import { buildShipmentProgressOverview } from './shipment-progress-groups.util';

describe('buildShipmentProgressOverview', () => {
  const listerNameById = new Map([['lister-1', 'Jane Boutique']]);

  it('builds separate rental and resale groups for mixed orders', () => {
    const overview = buildShipmentProgressOverview({
      orderItems: [
        {
          days: 3,
          outboundShipmentId: 'ob-1',
          returnShipmentId: 'ret-1',
          product: {
            name: 'Test Item 6',
            listingType: 'RENT_OR_RESALE',
            curator: { id: 'lister-1', name: 'Test Item 6' },
          },
        },
        {
          days: 0,
          resaleShipmentId: 'res-1',
          product: {
            name: 'Test resale Item',
            listingType: 'RENT_OR_RESALE',
            curator: { id: 'lister-1', name: 'Test resale Item' },
          },
        },
      ],
      shipments: [
        {
          id: 'ob-1',
          type: 'OUTBOUND',
          status: 'IN_TRANSIT',
          listerId: 'lister-1',
          trackingId: 'SB-OUT',
        },
        {
          id: 'ret-1',
          type: 'RETURN',
          status: 'PENDING',
          listerId: 'lister-1',
        },
        {
          id: 'res-1',
          type: 'RESALE',
          status: 'COMPLETED',
          listerId: 'lister-1',
          trackingId: 'SB-RES',
        },
      ],
      orderStatus: OrderStatus.IN_TRANSIT,
      listerNameById,
      orderCreatedAt: '2026-05-17T10:00:00.000Z',
    });

    expect(overview.groups).toHaveLength(2);
    expect(overview.groups[0].kind).toBe('rental');
    expect(overview.groups[0].title).toBe('Test Item 6');
    expect(overview.groups[0].listerName).toBe('Jane Boutique');
    expect(overview.groups[0].percentComplete).toBeLessThan(100);
    expect(overview.groups[1].kind).toBe('resale');
    expect(overview.groups[1].title).toBe('Test resale Item');
    expect(overview.groups[1].percentComplete).toBe(100);
    expect(overview.percentComplete).toBeGreaterThan(40);
    expect(overview.percentComplete).toBeLessThan(100);
    expect(overview.timeline).toHaveLength(3);
  });

  it('builds one rental group per outbound/return pair for multi-lister orders', () => {
    const overview = buildShipmentProgressOverview({
      orderItems: [
        {
          days: 3,
          outboundShipmentId: 'ob-a',
          returnShipmentId: 'ret-a',
          product: {
            name: 'Dress A',
            listingType: 'RENTAL',
            curator: { id: 'lister-a', name: 'Shop A' },
          },
        },
        {
          days: 3,
          outboundShipmentId: 'ob-b',
          returnShipmentId: 'ret-b',
          product: {
            name: 'Dress B',
            listingType: 'RENTAL',
            curator: { id: 'lister-b', name: 'Shop B' },
          },
        },
      ],
      shipments: [
        {
          id: 'ob-a',
          type: 'OUTBOUND',
          status: 'COMPLETED',
          listerId: 'lister-a',
        },
        {
          id: 'ret-a',
          type: 'RETURN',
          status: 'PENDING',
          listerId: 'lister-a',
        },
        {
          id: 'ob-b',
          type: 'OUTBOUND',
          status: 'COMPLETED',
          listerId: 'lister-b',
        },
        {
          id: 'ret-b',
          type: 'RETURN',
          status: 'PENDING',
          listerId: 'lister-b',
        },
      ],
      orderStatus: OrderStatus.RETURN_DUE,
      listerNameById: new Map([
        ['lister-a', 'Shop A'],
        ['lister-b', 'Shop B'],
      ]),
      orderCreatedAt: '2026-05-17T10:00:00.000Z',
    });

    const rentalGroups = overview.groups.filter((g) => g.kind === 'rental');
    expect(rentalGroups).toHaveLength(2);
    expect(rentalGroups[0].return?.shipmentId).toBe('ret-a');
    expect(rentalGroups[1].return?.shipmentId).toBe('ret-b');
    expect(rentalGroups[0].listerName).toBe('Shop A');
    expect(rentalGroups[1].listerName).toBe('Shop B');
  });

  it('hides lister name when it matches the product title', () => {
    const overview = buildShipmentProgressOverview({
      orderItems: [
        {
          days: 0,
          resaleShipmentId: 'res-1',
          product: {
            name: 'Solo resale',
            listingType: 'RESALE',
            curator: { id: 'lister-1', name: 'Solo resale' },
          },
        },
      ],
      shipments: [
        {
          id: 'res-1',
          type: 'RESALE',
          status: 'IN_TRANSIT',
          listerId: 'lister-1',
        },
      ],
      orderStatus: OrderStatus.IN_TRANSIT,
      listerNameById: new Map([['lister-1', 'Solo resale']]),
    });

    expect(overview.groups[0].listerName).toBeNull();
  });
});
