import { AvailabilityRequestReminderScheduler } from './availability-request-reminder.scheduler';

describe('AvailabilityRequestReminderScheduler.sendAvailabilityRequestReminders', () => {
  const mockNotification = {
    createNotification: jest.fn().mockResolvedValue({}),
  };

  function buildScheduler(prisma: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  }) {
    return new AvailabilityRequestReminderScheduler(
      {
        availabilityRequest: {
          updateMany: prisma.updateMany,
          findMany: prisma.findMany,
          update: prisma.update,
        },
      } as never,
      mockNotification as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLIENT_URL = 'https://app.relisted.test';
  });

  it('expires stale pending rows and sends checkout reminder for accepted requests', async () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(now);

    const approvedAt = new Date(now.getTime() - 20 * 60 * 1000);
    const acceptedRequest = {
      id: 'req-accepted',
      productId: 'prod-1',
      rentalDays: 3,
      approvedAt,
      reminderState: null,
      product: { name: 'Silk dress' },
      requester: {
        id: 'renter-1',
        name: 'Renter',
        email: 'renter@test.com',
      },
      lister: { name: 'Ada' },
    };

    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([acceptedRequest])
      .mockResolvedValueOnce([]);
    const update = jest.fn().mockResolvedValue({});

    const scheduler = buildScheduler({ updateMany, findMany, update });
    await scheduler.sendAvailabilityRequestReminders();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
        data: { status: 'EXPIRED' },
      }),
    );
    expect(mockNotification.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'renter-1',
        type: 'AVAILABILITY_CHECKOUT_REMINDER',
        emailData: expect.objectContaining({
          cartLink: 'https://app.relisted.test/shop/cart',
          stage: '15m',
        }),
      }),
    );
    expect(update).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
