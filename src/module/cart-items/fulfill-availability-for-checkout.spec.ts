import {
  findActiveOrderProductRequesterPairs,
  fulfillAvailabilityRequestsForCheckout,
  isAvailabilityRequestSupersededByActiveOrder,
} from './fulfill-availability-for-checkout';

describe('fulfillAvailabilityRequestsForCheckout', () => {
  it('marks checkout cart-line requests ORDERED and deletes stale terminal rows', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = {
      availabilityRequest: { updateMany, deleteMany },
    };

    await fulfillAvailabilityRequestsForCheckout(tx as never, {
      requesterId: 'renter-1',
      cartItemIds: ['cart-1'],
      productIds: ['prod-1', 'prod-1'],
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requesterId: 'renter-1',
          cartItemId: { in: ['cart-1'] },
          status: { in: ['PENDING', 'ACCEPTED'] },
        }),
        data: { status: 'ORDERED' },
      }),
    );
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requesterId: 'renter-1',
          productId: { in: ['prod-1'] },
        }),
      }),
    );
  });
});

describe('findActiveOrderProductRequesterPairs', () => {
  it('returns product/requester keys with an in-flight order', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        userId: 'renter-1',
        orderItems: [{ productId: 'prod-1' }, { productId: 'prod-2' }],
      },
    ]);

    const active = await findActiveOrderProductRequesterPairs(
      { order: { findMany } },
      [
        { productId: 'prod-1', requesterId: 'renter-1' },
        { productId: 'prod-2', requesterId: 'renter-2' },
      ],
    );

    expect(active).toEqual(new Set(['prod-1:renter-1']));
    expect(isAvailabilityRequestSupersededByActiveOrder(active, {
      productId: 'prod-1',
      requesterId: 'renter-1',
    })).toBe(true);
  });
});
