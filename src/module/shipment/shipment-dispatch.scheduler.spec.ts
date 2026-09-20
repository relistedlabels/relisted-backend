import { ShipmentDispatchScheduler } from './shipment-dispatch.scheduler';
import { notifyAdminsReturnRequestPastDue } from './notify-admins-return-request-past-due.util';

jest.mock('./notify-admins-return-request-past-due.util', () => ({
  notifyAdminsReturnRequestPastDue: jest.fn().mockResolvedValue(1),
}));

const mockNotifyAdminsReturnRequestPastDue =
  notifyAdminsReturnRequestPastDue as jest.MockedFunction<
    typeof notifyAdminsReturnRequestPastDue
  >;

describe('ShipmentDispatchScheduler.dispatchDueShipments', () => {
  const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

  function buildScheduler(prisma: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
  }) {
    return new ShipmentDispatchScheduler(
      {
        shipment: {
          findMany: prisma.findMany,
          updateMany: prisma.updateMany,
        },
      } as never,
      mockQueue as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('locks due shipments and enqueues dispatch jobs once each', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'ship-1' }, { id: 'ship-2' }]);
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const scheduler = buildScheduler({ findMany, updateMany });
    await scheduler.dispatchDueShipments();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'dispatch',
      { shipmentId: 'ship-1' },
      { attempts: 1 },
    );
  });

  it('does not enqueue when no shipments are due', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const updateMany = jest.fn();

    const scheduler = buildScheduler({ findMany, updateMany });
    await scheduler.dispatchDueShipments();

    expect(updateMany).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});

describe('ShipmentDispatchScheduler.recoverStaleDispatching', () => {
  const mockQueue = { add: jest.fn() };

  it('resets shipments stuck in DISPATCHING back to PENDING', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const scheduler = new ShipmentDispatchScheduler(
      { shipment: { updateMany } } as never,
      mockQueue as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await scheduler.recoverStaleDispatching();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'DISPATCHING' }),
        data: { status: 'PENDING' },
      }),
    );
  });
});

describe('ShipmentDispatchScheduler.pollTrackingStatus', () => {
  const mockProvider = {
    getTrackingStatus: jest.fn().mockResolvedValue({
      status: 'IN_TRANSIT',
      message: 'On the way',
    }),
  };
  const mockDelivery = {
    forShipment: jest.fn().mockReturnValue(mockProvider),
  };
  const mockTrackingSync = {
    applyProviderTrackingUpdate: jest
      .fn()
      .mockResolvedValue({ updated: true }),
  };

  function buildScheduler(prisma: {
    count: jest.Mock;
    findMany: jest.Mock;
  }) {
    return new ShipmentDispatchScheduler(
      {
        shipment: {
          count: prisma.count,
          findMany: prisma.findMany,
        },
      } as never,
      { add: jest.fn() } as never,
      mockDelivery as never,
      {} as never,
      {} as never,
      mockTrackingSync as never,
      {} as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('polls provider tracking and applies forward-only status updates', async () => {
    const shipment = {
      id: 'ship-1',
      listerId: 'lister-1',
      providerShipmentId: 'prov-1',
      trackingId: 'TRK-1',
      status: 'DISPATCHED',
      type: 'OUTBOUND',
      order: {
        id: 'order-1',
        orderId: 'ORD-1',
        user: { id: 'user-1', name: 'Renter', email: 'r@test.com' },
      },
    };
    const count = jest.fn().mockResolvedValue(1);
    const findMany = jest.fn().mockResolvedValue([shipment]);

    const scheduler = buildScheduler({ count, findMany });
    await scheduler.pollTrackingStatus();

    expect(count).toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['DISPATCHED', 'IN_TRANSIT'] },
        }),
      }),
    );
    expect(mockDelivery.forShipment).toHaveBeenCalledWith(shipment);
    expect(mockProvider.getTrackingStatus).toHaveBeenCalledWith({
      providerShipmentId: 'prov-1',
      trackingId: 'TRK-1',
    });
    expect(mockTrackingSync.applyProviderTrackingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment,
        providerStatus: 'IN_TRANSIT',
        source: 'poll',
      }),
    );
  });

  it('continues polling when one shipment throws', async () => {
    const shipments = [
      {
        id: 'ship-bad',
        providerShipmentId: 'bad',
        trackingId: null,
        status: 'IN_TRANSIT',
        type: 'OUTBOUND',
        order: { id: 'o1', orderId: 'O1', user: { id: 'u1', name: 'U', email: 'u@t.com' } },
      },
      {
        id: 'ship-ok',
        providerShipmentId: 'ok',
        trackingId: 'T1',
        status: 'IN_TRANSIT',
        type: 'OUTBOUND',
        order: { id: 'o2', orderId: 'O2', user: { id: 'u2', name: 'U', email: 'u@t.com' } },
      },
    ];
    mockProvider.getTrackingStatus
      .mockRejectedValueOnce(new Error('carrier timeout'))
      .mockResolvedValueOnce({ status: 'DELIVERED' });
    mockTrackingSync.applyProviderTrackingUpdate.mockResolvedValue({
      updated: false,
    });

    const scheduler = buildScheduler({
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue(shipments),
    });
    await scheduler.pollTrackingStatus();

    expect(mockProvider.getTrackingStatus).toHaveBeenCalledTimes(2);
    expect(mockTrackingSync.applyProviderTrackingUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('ShipmentDispatchScheduler.sendRenterReturnDueReminders', () => {
  const mockNotification = {
    createNotification: jest.fn().mockResolvedValue({}),
  };

  function buildScheduler(prisma: {
    findMany: jest.Mock;
    returnRequestUpdate?: jest.Mock;
    shipmentUpdate?: jest.Mock;
  }) {
    return new ShipmentDispatchScheduler(
      {
        shipment: {
          findMany: prisma.findMany,
          update: prisma.shipmentUpdate ?? jest.fn(),
        },
        returnRequest: {
          update: prisma.returnRequestUpdate ?? jest.fn(),
        },
      } as never,
      { add: jest.fn() } as never,
      {} as never,
      mockNotification as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends a 24-hour return pickup reminder and stamps return request', async () => {
    const now = new Date('2026-05-10T07:00:00+01:00');
    jest.setSystemTime(now);

    const pickupStart = new Date('2026-05-11T06:00:00+01:00');
    const pickupEnd = new Date('2026-05-11T08:00:00+01:00');
    const returnRequestUpdate = jest.fn().mockResolvedValue({});

    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'ship-ret-1',
        listerId: 'lister-1',
        scheduledWindowStart: pickupStart,
        scheduledWindowEnd: pickupEnd,
        returnDueReminder24hSentAt: null,
        returnDueReminderMorningSentAt: null,
        returnRequests: [
          {
            id: 'rr-1',
            pickupWindowStart: pickupStart,
            pickupWindowEnd: pickupEnd,
            reminder24hSentAt: null,
            reminderDayOfSentAt: null,
          },
        ],
        order: {
          id: 'order-1',
          orderId: 'ORD-RET-1',
          userId: 'user-1',
          user: { email: 'renter@test.com', name: 'Renter' },
          orderItems: [
            {
              returnShipmentId: 'ship-ret-1',
              product: {
                name: 'Silk dress',
                curator: { id: 'lister-1' },
              },
            },
          ],
        },
      },
    ]);

    const scheduler = buildScheduler({ findMany, returnRequestUpdate });
    await scheduler.sendRenterReturnDueReminders();

    expect(mockNotification.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Return pickup due in 24 hours',
        type: 'RETURN_DUE_REMINDER',
        metadata: expect.objectContaining({ reminderType: '24_hours' }),
      }),
    );
    expect(returnRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'rr-1' },
      data: { reminder24hSentAt: now },
    });
  });

  it('sends a morning-of return pickup reminder when return request is only linked on the order', async () => {
    const now = new Date('2026-05-11T08:00:00+01:00');
    jest.setSystemTime(now);

    const pickupStart = new Date('2026-05-11T10:00:00+01:00');
    const pickupEnd = new Date('2026-05-11T12:00:00+01:00');
    const returnRequestUpdate = jest.fn().mockResolvedValue({});

    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'ship-ret-1',
        listerId: 'lister-1',
        scheduledWindowStart: pickupStart,
        scheduledWindowEnd: pickupEnd,
        returnDueReminder24hSentAt: new Date('2026-05-10T08:00:00+01:00'),
        returnDueReminderMorningSentAt: null,
        returnRequests: [],
        order: {
          id: 'order-1',
          orderId: 'ORD-RET-1',
          userId: 'user-1',
          user: { email: 'renter@test.com', name: 'Renter' },
          returnRequests: [
            {
              id: 'rr-1',
              shipmentId: null,
              pickupWindowStart: pickupStart,
              pickupWindowEnd: pickupEnd,
              reminder24hSentAt: new Date('2026-05-10T08:00:00+01:00'),
              reminderDayOfSentAt: null,
            },
          ],
          orderItems: [
            {
              returnShipmentId: 'ship-ret-1',
              product: {
                name: 'Silk dress',
                curator: { id: 'lister-1' },
              },
            },
          ],
        },
      },
    ]);

    const scheduler = buildScheduler({ findMany, returnRequestUpdate });
    await scheduler.sendRenterReturnDueReminders();

    expect(mockNotification.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Return pickup is today',
        type: 'RETURN_DUE_REMINDER',
      }),
    );
    expect(returnRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'rr-1' },
      data: { reminderDayOfSentAt: now },
    });
  });

  it('sends a morning-of return pickup reminder on pickup day in Lagos', async () => {
    const now = new Date('2026-05-11T08:00:00+01:00');
    jest.setSystemTime(now);

    const pickupStart = new Date('2026-05-11T10:00:00+01:00');
    const pickupEnd = new Date('2026-05-11T12:00:00+01:00');
    const returnRequestUpdate = jest.fn().mockResolvedValue({});

    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'ship-ret-1',
        listerId: 'lister-1',
        scheduledWindowStart: pickupStart,
        scheduledWindowEnd: pickupEnd,
        returnDueReminder24hSentAt: new Date('2026-05-10T08:00:00+01:00'),
        returnDueReminderMorningSentAt: null,
        returnRequests: [
          {
            id: 'rr-1',
            pickupWindowStart: pickupStart,
            pickupWindowEnd: pickupEnd,
            reminder24hSentAt: new Date('2026-05-10T08:00:00+01:00'),
            reminderDayOfSentAt: null,
          },
        ],
        order: {
          id: 'order-1',
          orderId: 'ORD-RET-1',
          userId: 'user-1',
          user: { email: 'renter@test.com', name: 'Renter' },
          orderItems: [
            {
              returnShipmentId: 'ship-ret-1',
              product: {
                name: 'Silk dress',
                curator: { id: 'lister-1' },
              },
            },
          ],
        },
      },
    ]);

    const scheduler = buildScheduler({ findMany, returnRequestUpdate });
    await scheduler.sendRenterReturnDueReminders();

    expect(mockNotification.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Return pickup is today',
        type: 'RETURN_DUE_REMINDER',
        metadata: expect.objectContaining({ reminderType: 'morning_of' }),
      }),
    );
    expect(returnRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'rr-1' },
      data: { reminderDayOfSentAt: now },
    });
  });
});

describe('ShipmentDispatchScheduler.sendReturnRequestCompletionReminders', () => {
  const mockNotification = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const mockMail = {
    sendReturnRequestReminderMail: jest.fn(),
  };

  function buildScheduler(prisma: {
    findMany: jest.Mock;
    shipmentUpdate?: jest.Mock;
  }) {
    return new ShipmentDispatchScheduler(
      {
        shipment: {
          findMany: prisma.findMany,
          update: prisma.shipmentUpdate ?? jest.fn().mockResolvedValue({}),
        },
      } as never,
      { add: jest.fn() } as never,
      {} as never,
      mockNotification as never,
      mockMail as never,
      {} as never,
      {} as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifyAdminsReturnRequestPastDue.mockResolvedValue(1);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('notifies admins when return window is past due and renter has no return request', async () => {
    const now = new Date('2026-06-10T14:30:00+01:00');
    jest.setSystemTime(now);

    const windowStart = new Date('2026-06-10T07:00:00+01:00');
    const windowEnd = new Date('2026-06-10T12:00:00+01:00');
    const shipmentUpdate = jest.fn().mockResolvedValue({});

    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'ship-ret-1',
        listerId: 'lister-1',
        scheduledWindowStart: windowStart,
        scheduledWindowEnd: windowEnd,
        returnRequestReminderState: {
          sent: {
            past_due_morning: new Date('2026-06-10T07:00:00+01:00').toISOString(),
          },
        },
        adminReturnRequestPastDueLastNotifiedAt: null,
        order: {
          id: 'order-uuid-1',
          orderId: 'ORD-1001',
          userId: 'user-1',
          user: { email: 'renter@test.com', name: 'Jane Renter' },
          escrows: [{ listerId: 'lister-1', collateralAmount: 50000 }],
          orderItems: [
            {
              returnShipmentId: 'ship-ret-1',
              product: {
                name: 'Silk dress',
                curator: {
                  id: 'lister-1',
                  name: 'Curator',
                  profile: {
                    businessInfo: { businessName: 'Style Closet' },
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const scheduler = buildScheduler({ findMany, shipmentUpdate });
    await scheduler.sendReturnRequestCompletionReminders();

    expect(mockNotification.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'RETURN_REQUEST_REMINDER',
      }),
    );
    expect(mockNotifyAdminsReturnRequestPastDue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        orderId: 'order-uuid-1',
        humanOrderId: 'ORD-1001',
        shipmentId: 'ship-ret-1',
        renterEmail: 'renter@test.com',
        productName: 'Silk dress',
      }),
    );
    expect(shipmentUpdate).toHaveBeenCalledWith({
      where: { id: 'ship-ret-1' },
      data: { adminReturnRequestPastDueLastNotifiedAt: now },
    });
  });

  it('skips completion reminders when order already has a return request without shipment link', async () => {
    const now = new Date('2026-06-10T07:55:00+01:00');
    jest.setSystemTime(now);

    const windowStart = new Date('2026-06-10T08:00:00+01:00');
    const windowEnd = new Date('2026-06-10T09:00:00+01:00');

    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'ship-ret-1',
        listerId: 'lister-1',
        scheduledWindowStart: windowStart,
        scheduledWindowEnd: windowEnd,
        returnRequestReminderState: null,
        adminReturnRequestPastDueLastNotifiedAt: null,
        order: {
          id: 'order-uuid-1',
          orderId: 'ORD-1001',
          userId: 'user-1',
          user: { email: 'renter@test.com', name: 'Jane Renter' },
          returnRequests: [{ id: 'rr-1', shipmentId: null }],
          escrows: [],
          orderItems: [
            {
              returnShipmentId: 'ship-ret-1',
              product: {
                name: 'Silk dress',
                curator: { id: 'lister-1', name: 'Curator' },
              },
            },
          ],
        },
      },
    ]);

    const scheduler = buildScheduler({ findMany });
    await scheduler.sendReturnRequestCompletionReminders();

    expect(mockNotification.createNotification).not.toHaveBeenCalled();
    expect(mockNotifyAdminsReturnRequestPastDue).not.toHaveBeenCalled();
  });

  it('does not notify admins again on the same Lagos calendar day', async () => {
    const now = new Date('2026-06-10T20:00:00+01:00');
    jest.setSystemTime(now);

    const windowStart = new Date('2026-06-10T07:00:00+01:00');
    const windowEnd = new Date('2026-06-10T12:00:00+01:00');
    const earlierToday = new Date('2026-06-10T14:00:00+01:00');

    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'ship-ret-1',
        listerId: 'lister-1',
        scheduledWindowStart: windowStart,
        scheduledWindowEnd: windowEnd,
        returnRequestReminderState: {
          sent: {
            past_due_morning: new Date('2026-06-10T07:00:00+01:00').toISOString(),
            past_due_afternoon: earlierToday.toISOString(),
          },
        },
        adminReturnRequestPastDueLastNotifiedAt: earlierToday,
        order: {
          id: 'order-uuid-1',
          orderId: 'ORD-1001',
          userId: 'user-1',
          user: { email: 'renter@test.com', name: 'Jane Renter' },
          escrows: [],
          orderItems: [
            {
              returnShipmentId: 'ship-ret-1',
              product: {
                name: 'Silk dress',
                curator: { id: 'lister-1', name: 'Curator' },
              },
            },
          ],
        },
      },
    ]);

    const scheduler = buildScheduler({ findMany });
    await scheduler.sendReturnRequestCompletionReminders();

    expect(mockNotifyAdminsReturnRequestPastDue).not.toHaveBeenCalled();
  });
});

describe('ShipmentDispatchScheduler inspection auto-release crons', () => {
  it('delegates resale auto-complete to OrderService', async () => {
    const autoCompleteDeliveredResaleOrders = jest
      .fn()
      .mockResolvedValue({ processed: 2 });
    const scheduler = new ShipmentDispatchScheduler(
      {} as never,
      { add: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { autoCompleteDeliveredResaleOrders } as never,
    );

    await scheduler.autoReleaseResaleAfterInspectionPeriod();

    expect(autoCompleteDeliveredResaleOrders).toHaveBeenCalled();
  });

  it('delegates rental auto-confirm to OrderService', async () => {
    const autoConfirmDeliveredRentalOrders = jest
      .fn()
      .mockResolvedValue({ processed: 1 });
    const scheduler = new ShipmentDispatchScheduler(
      {} as never,
      { add: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { autoConfirmDeliveredRentalOrders } as never,
    );

    await scheduler.autoConfirmRentalAfterInspectionPeriod();

    expect(autoConfirmDeliveredRentalOrders).toHaveBeenCalled();
  });
});
