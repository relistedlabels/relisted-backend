import {
  findReturnRequestForLister,
  productNamesForReturnLeg,
  returnLegItemPreviews,
  returnRequestExistsForShipment,
} from './return-request-leg.util';

describe('return-request-leg.util', () => {
  const shipments = [
    { id: 'ret-a', type: 'RETURN', listerId: 'lister-a' },
    { id: 'ret-b', type: 'RETURN', listerId: 'lister-b' },
  ];

  const returnRequests = [
    { id: 'rr-a', shipmentId: 'ret-a', status: 'PENDING_PICKUP' },
    { id: 'rr-b', shipmentId: 'ret-b', status: 'COMPLETED' },
  ];

  it('findReturnRequestForLister matches by return leg listerId', () => {
    expect(
      findReturnRequestForLister(returnRequests, shipments, 'lister-b')?.id,
    ).toBe('rr-b');
  });

  it('returnRequestExistsForShipment is per shipment', () => {
    expect(returnRequestExistsForShipment(returnRequests, 'ret-a')).toBe(true);
    expect(returnRequestExistsForShipment(returnRequests, 'ret-c')).toBe(false);
  });

  it('returns null when lister has no matching return leg', () => {
    expect(
      findReturnRequestForLister(returnRequests, shipments, 'lister-c'),
    ).toBeNull();
  });

  it('falls back to sole return request for single-lister orders', () => {
    const single = [{ id: 'rr-only', shipmentId: null, status: 'PENDING' }];
    expect(
      findReturnRequestForLister(single, [{ id: 'ret-1', type: 'RETURN' }], 'lister-x'),
    ).toBe(single[0]);
  });

  it('does not assign another listers return request when only one exists', () => {
    const single = [{ id: 'rr-a', shipmentId: 'ret-a', status: 'PENDING' }];
    expect(
      findReturnRequestForLister(single, shipments, 'lister-b'),
    ).toBeNull();
  });

  it('productNamesForReturnLeg scopes labels to the return shipment', () => {
    const orderItems = [
      {
        returnShipmentId: 'ret-a',
        product: { name: 'Dress A', curator: { id: 'lister-a' } },
      },
      {
        returnShipmentId: 'ret-b',
        product: { name: 'Dress B', curator: { id: 'lister-b' } },
      },
    ];
    expect(productNamesForReturnLeg(orderItems, 'ret-b', 'lister-b')).toBe(
      'Dress B',
    );
  });

  it('returnLegItemPreviews returns name and image per leg', () => {
    const previews = returnLegItemPreviews(
      [
        {
          returnShipmentId: 'ret-b',
          product: {
            name: 'Dress B',
            attachments: { uploads: [{ url: 'https://img/b.jpg' }] },
          },
        },
      ],
      'ret-b',
      'lister-b',
    );
    expect(previews).toEqual([
      { name: 'Dress B', imageUrl: 'https://img/b.jpg' },
    ]);
  });
});
