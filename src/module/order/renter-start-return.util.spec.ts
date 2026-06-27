import { resolveRenterStartReturn } from './renter-start-return.util';

const rentalItem = {
  days: 3,
  product: { listingType: 'RENTAL' as const },
};

describe('resolveRenterStartReturn', () => {
  it('shows return when outbound is delivered and no return request exists', () => {
    const result = resolveRenterStartReturn({
      status: 'ACTIVE',
      orderItems: [rentalItem],
      shipments: [
        { id: 'ob-1', type: 'OUTBOUND', status: 'COMPLETED', listerId: 'l1' },
        { id: 'ret-1', type: 'RETURN', status: 'PENDING', listerId: 'l1' },
      ],
      returnRequests: [],
    });

    expect(result).toEqual({
      showStartReturn: true,
      returnShipmentId: 'ret-1',
    });
  });

  it('hides return when outbound is not yet delivered', () => {
    const result = resolveRenterStartReturn({
      status: 'IN_TRANSIT',
      orderItems: [rentalItem],
      shipments: [
        { id: 'ob-1', type: 'OUTBOUND', status: 'IN_TRANSIT', listerId: 'l1' },
        { id: 'ret-1', type: 'RETURN', status: 'PENDING', listerId: 'l1' },
      ],
      returnRequests: [],
    });

    expect(result.showStartReturn).toBe(false);
  });

  it('hides return when a return request is already active', () => {
    const result = resolveRenterStartReturn({
      status: 'RETURN_DUE',
      orderItems: [rentalItem],
      shipments: [
        { id: 'ob-1', type: 'OUTBOUND', status: 'COMPLETED', listerId: 'l1' },
        { id: 'ret-1', type: 'RETURN', status: 'PENDING', listerId: 'l1' },
      ],
      returnRequests: [{ shipmentId: 'ret-1', status: 'PENDING' }],
    });

    expect(result.showStartReturn).toBe(false);
  });

  it('allows return again when the prior request was rejected', () => {
    const result = resolveRenterStartReturn({
      status: 'ACTIVE',
      orderItems: [rentalItem],
      shipments: [
        { id: 'ob-1', type: 'OUTBOUND', status: 'COMPLETED', listerId: 'l1' },
        { id: 'ret-1', type: 'RETURN', status: 'PENDING', listerId: 'l1' },
      ],
      returnRequests: [{ shipmentId: 'ret-1', status: 'REJECTED' }],
    });

    expect(result.showStartReturn).toBe(true);
  });

  it('skips resale-only orders', () => {
    const result = resolveRenterStartReturn({
      status: 'DELIVERED',
      orderItems: [{ days: 0, product: { listingType: 'RESALE' } }],
      shipments: [
        { id: 'rs-1', type: 'RESALE', status: 'COMPLETED', listerId: 'l1' },
      ],
      returnRequests: [],
    });

    expect(result.showStartReturn).toBe(false);
  });
});
