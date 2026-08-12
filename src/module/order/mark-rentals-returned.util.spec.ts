import {
  markRentalsReturnedForOrder,
  orderHasCompletedReturnRequest,
} from './mark-rentals-returned.util';

describe('mark-rentals-returned.util', () => {
  describe('orderHasCompletedReturnRequest', () => {
    it('returns true when returnRequests includes COMPLETED', () => {
      expect(
        orderHasCompletedReturnRequest({
          returnRequests: [{ status: 'PENDING' }, { status: 'COMPLETED' }],
        }),
      ).toBe(true);
    });

    it('returns true for legacy returnRequest field', () => {
      expect(
        orderHasCompletedReturnRequest({
          returnRequest: { status: 'COMPLETED' },
        }),
      ).toBe(true);
    });

    it('returns false when no completed return', () => {
      expect(
        orderHasCompletedReturnRequest({
          returnRequests: [{ status: 'PENDING' }],
        }),
      ).toBe(false);
    });
  });

  describe('markRentalsReturnedForOrder', () => {
    it('updates open rentals on the order', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const tx = { rental: { updateMany } } as any;

      const count = await markRentalsReturnedForOrder(tx, 'order-1');

      expect(count).toBe(2);
      expect(updateMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1', isReturned: false },
        data: expect.objectContaining({
          isReturned: true,
          returnedAt: expect.any(Date),
        }),
      });
    });
  });
});
