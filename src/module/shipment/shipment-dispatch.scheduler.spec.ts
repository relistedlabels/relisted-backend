import { ShipmentDispatchScheduler } from './shipment-dispatch.scheduler';

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
