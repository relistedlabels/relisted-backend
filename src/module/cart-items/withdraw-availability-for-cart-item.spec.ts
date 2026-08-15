import {
  buildListerWithdrawRentalRequestEmailContext,
  withdrawAvailabilityRequestsForCartItem,
} from './withdraw-availability-for-cart-item';

describe('buildListerWithdrawRentalRequestEmailContext', () => {
  const baseRow = {
    id: 'req-1',
    rentalDays: 3,
    totalPrice: 15000,
    startDate: new Date('2026-05-10T00:00:00.000Z'),
    endDate: new Date('2026-05-12T00:00:00.000Z'),
    product: {
      name: 'Silk dress',
      curator: { email: 'lister@test.com', name: 'Ada' },
    },
    requester: { name: 'Renter One' },
  };

  beforeEach(() => {
    process.env.CLIENT_URL = 'https://app.relisted.test';
  });

  it('builds lister email payload for pending withdrawal', () => {
    const emailData = buildListerWithdrawRentalRequestEmailContext(
      baseRow,
      false,
    );

    expect(emailData).toMatchObject({
      email: 'lister@test.com',
      listerName: 'Ada',
      renterName: 'Renter One',
      productName: 'Silk dress',
      requestId: 'req-1',
      rentalDays: 3,
      totalPrice: 15000,
      viewLink: 'https://app.relisted.test/listers/orders/req-1',
      withdrawn: true,
      afterApproval: false,
    });
    expect(emailData.startDate).not.toBe('N/A');
    expect(emailData.endDate).not.toBe('N/A');
  });

  it('marks afterApproval when renter withdraws after lister accepted', () => {
    const emailData = buildListerWithdrawRentalRequestEmailContext(
      baseRow,
      true,
    );
    expect(emailData.afterApproval).toBe(true);
  });
});

describe('withdrawAvailabilityRequestsForCartItem', () => {
  it('returns early when cartItemId is empty', async () => {
    const tx = { availabilityRequest: { findMany: jest.fn() } };
    await expect(
      withdrawAvailabilityRequestsForCartItem(tx as never, '', 'user-1'),
    ).resolves.toEqual([]);
    expect(tx.availabilityRequest.findMany).not.toHaveBeenCalled();
  });

  it('cancels pending and accepted requests and returns notify payloads', async () => {
    const pendingRow = {
      id: 'req-pending',
      status: 'PENDING',
      listerId: 'lister-1',
      rentalDays: 2,
      totalPrice: 5000,
      startDate: null,
      endDate: null,
      product: {
        name: 'Bag',
        curator: { email: 'l@test.com', name: 'L' },
      },
      requester: { name: 'R' },
    };
    const acceptedRow = {
      id: 'req-accepted',
      status: 'ACCEPTED',
      listerId: 'lister-2',
      rentalDays: 4,
      totalPrice: 9000,
      startDate: null,
      endDate: null,
      product: {
        name: 'Shoes',
        curator: { email: 'l2@test.com', name: 'L2' },
      },
      requester: { name: 'R2' },
    };

    const update = jest.fn().mockResolvedValue(undefined);
    const tx = {
      availabilityRequest: {
        findMany: jest
          .fn()
          .mockResolvedValue([pendingRow, acceptedRow, { status: 'REJECTED' }]),
        update,
      },
    };

    const result = await withdrawAvailabilityRequestsForCartItem(
      tx as never,
      'cart-line-1',
      'renter-1',
    );

    expect(tx.availabilityRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cartItemId: 'cart-line-1', requesterId: 'renter-1' },
      }),
    );
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'req-pending' },
      data: { status: 'CANCELLED_BY_RENTER' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'req-accepted' },
      data: { status: 'CANCELLED_BY_RENTER' },
    });
    expect(result).toHaveLength(2);
    expect(result[0].afterApproval).toBe(false);
    expect(result[1].afterApproval).toBe(true);
  });
});
