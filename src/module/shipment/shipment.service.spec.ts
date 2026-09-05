import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { ShipmentQuoteService } from './shipment-quote.service';
import { RELISTED_DISPATCH_SHIPPING_LABEL } from 'src/constants/relisted-dispatch-shipping';

const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

function customerFacingNotificationText(payload: {
  title?: string;
  message?: string;
  emailData?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    title: payload.title,
    message: payload.message,
    emailData: payload.emailData,
  }).toLowerCase();
}

describe('ShipmentService.getRatePreview', () => {
  function buildService(deps: {
    shipment?: Record<string, unknown> | null;
    preview?: Record<string, unknown>;
  }) {
    const prisma = {
      shipment: {
        findUnique: jest.fn().mockResolvedValue(deps.shipment ?? null),
      },
    };
    const shipmentQuoteService = {
      previewRates: jest.fn().mockResolvedValue(
        deps.preview ?? { tiers: [], forImmediate: false },
      ),
    } as unknown as ShipmentQuoteService;

    const service = new ShipmentService(
      prisma as any,
      mockQueue as any,
      {} as any,
      shipmentQuoteService,
    );
    return { service, prisma, shipmentQuoteService };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NotFoundException for unknown shipment id', async () => {
    const { service } = buildService({ shipment: null });

    await expect(service.getRatePreview('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects rate preview for non-pending statuses', async () => {
    const { service, shipmentQuoteService } = buildService({
      shipment: { id: 's1', status: 'DISPATCHED' },
    });

    await expect(service.getRatePreview('s1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(shipmentQuoteService.previewRates).not.toHaveBeenCalled();
  });

  it('allows PENDING and DISPATCH_FAILED shipments', async () => {
    for (const status of ['PENDING', 'DISPATCH_FAILED'] as const) {
      const { service, shipmentQuoteService } = buildService({
        shipment: { id: 's1', status },
      });

      const result = await service.getRatePreview('s1', true);
      expect(result.success).toBe(true);
      expect(shipmentQuoteService.previewRates).toHaveBeenCalledWith('s1', true);
    }
  });

  it('passes forImmediate=false by default', async () => {
    const { service, shipmentQuoteService } = buildService({
      shipment: { id: 's1', status: 'PENDING' },
    });

    await service.getRatePreview('s1');
    expect(shipmentQuoteService.previewRates).toHaveBeenCalledWith('s1', false);
  });
});

describe('ShipmentService.dispatchNow', () => {
  function buildService(deps: {
    shipment?: Record<string, unknown> | null;
    returnRequest?: Record<string, unknown> | null | false;
    updateManyCount?: number;
    findTierResult?: Record<string, unknown> | null;
  }) {
    const prisma = {
      shipment: {
        findUnique: jest.fn().mockResolvedValue(deps.shipment ?? null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: deps.updateManyCount ?? 1 }),
      },
      returnRequest: {
        findFirst: jest.fn().mockResolvedValue(
          deps.returnRequest === false
            ? null
            : (deps.returnRequest ?? { id: 'rr-1' }),
        ),
      },
    };
    const defaultTier = {
      pricingTier: 'chowdeck',
      name: 'Chowdeck',
      shipmentChargeKobo: 320000,
      pickupChargeKobo: 0,
      vatChargeKobo: 24000,
      totalCostKobo: 344000,
      deltaKobo: -156000,
    };
    const shipmentQuoteService = {
      previewRates: jest.fn().mockResolvedValue({ tiers: [defaultTier] }),
      findTierInPreview: jest
        .fn()
        .mockReturnValue(
          deps.findTierResult === null ? null : (deps.findTierResult ?? defaultTier),
        ),
      tierToShipmentCharges: jest.fn().mockReturnValue({
        pricingTier: 'chowdeck',
        shipmentCharge: 320000,
        pickupCharge: 0,
        vatCharge: 24000,
        pickupId: null,
        pickupPartner: 'chowdeck',
      }),
    } as unknown as ShipmentQuoteService;

    const service = new ShipmentService(
      prisma as any,
      mockQueue as any,
      {} as any,
      shipmentQuoteService,
    );
    return { service, prisma, shipmentQuoteService };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires a carrier tier for Relisted dispatch shipments', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: true,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL,
        scheduledWindowStart: new Date(Date.now() + 86400000),
        scheduledDate: new Date(),
      },
    });

    await expect(service.dispatchNow('s1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('blocks return legs without a return request', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: false,
        type: 'RETURN',
        orderId: 'o1',
        pricingTier: 'chowdeck',
        scheduledWindowStart: new Date(Date.now() + 86400000),
        scheduledDate: new Date(),
      },
      returnRequest: false,
    });

    await expect(
      service.dispatchNow('s1', { pricingTier: 'chowdeck' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFoundException for unknown shipment', async () => {
    const { service } = buildService({ shipment: null });

    await expect(service.dispatchNow('missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects dispatch for statuses other than PENDING or DISPATCH_FAILED', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'IN_TRANSIT',
        manualFulfillment: false,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: 'chowdeck',
        scheduledWindowStart: new Date(),
        scheduledDate: new Date(),
      },
    });

    await expect(service.dispatchNow('s1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unavailable pricing tiers from preview', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: true,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL,
        scheduledWindowStart: new Date(Date.now() + 86400000),
        scheduledDate: new Date(),
      },
      findTierResult: null,
    });

    await expect(
      service.dispatchNow('s1', { pricingTier: 'unknown_courier' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects booking Relisted dispatch through carrier dispatch', async () => {
    const relistedTier = {
      pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL,
      name: RELISTED_DISPATCH_SHIPPING_LABEL,
      shipmentChargeKobo: 500000,
      pickupChargeKobo: 0,
      vatChargeKobo: 0,
      totalCostKobo: 500000,
      deltaKobo: 0,
    };
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: true,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL,
        scheduledWindowStart: new Date(Date.now() + 86400000),
        scheduledDate: new Date(),
      },
      findTierResult: relistedTier,
    });

    await expect(
      service.dispatchNow('s1', { pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enqueues dispatch for automated future shipments without tier change', async () => {
    const { service, prisma } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: false,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: 'chowdeck',
        scheduledWindowStart: new Date(Date.now() + 86400000),
        scheduledDate: new Date(),
      },
    });

    const result = await service.dispatchNow('s1', {});

    expect(result.success).toBe(true);
    expect(prisma.shipment.updateMany).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalledWith(
      'dispatch',
      { shipmentId: 's1' },
      { attempts: 1 },
    );
  });

  it('converts manual fulfillment to carrier booking and clears stale provider id on tier change', async () => {
    const { service, prisma, shipmentQuoteService } = buildService({
      shipment: {
        id: 's1',
        status: 'DISPATCH_FAILED',
        manualFulfillment: true,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL,
        providerShipmentId: 'stale-provider',
        scheduledWindowStart: new Date(Date.now() + 86400000),
        scheduledDate: new Date(),
      },
    });

    const result = await service.dispatchNow('s1', {
      pricingTier: 'chowdeck',
      updateWindow: true,
    });

    expect(result.message).toBe('Dispatch enqueued successfully');
    expect(shipmentQuoteService.previewRates).toHaveBeenCalledWith('s1', true);
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          manualFulfillment: false,
          providerShipmentId: null,
          dispatchAttempts: 0,
          scheduledWindowStart: expect.any(Date),
        }),
      }),
    );
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'PENDING' },
    });
  });

  it('does not pull dispatch window forward when updateWindow is false', async () => {
    const { service, prisma, shipmentQuoteService } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: false,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: 'chowdeck',
        scheduledWindowStart: new Date(Date.now() + 86400000),
        scheduledDate: new Date(),
      },
    });

    await service.dispatchNow('s1', { updateWindow: false });

    expect(shipmentQuoteService.previewRates).not.toHaveBeenCalled();
    expect(prisma.shipment.update).not.toHaveBeenCalled();
  });

  it('throws ConflictException when another process already locked the shipment', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: false,
        type: 'OUTBOUND',
        orderId: 'o1',
        pricingTier: 'chowdeck',
        scheduledWindowStart: new Date(),
        scheduledDate: new Date(),
      },
      updateManyCount: 0,
    });

    await expect(service.dispatchNow('s1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});

describe('ShipmentService.reconcileManualFulfillment', () => {
  function buildService(deps: {
    shipment?: Record<string, unknown> | null;
  }) {
    const prisma = {
      shipment: {
        findUnique: jest.fn().mockResolvedValue(deps.shipment ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const shipmentQuoteService = {} as ShipmentQuoteService;
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ShipmentService(
      prisma as any,
      { add: jest.fn() } as any,
      notificationService as any,
      shipmentQuoteService,
    );
    return { service, prisma, notificationService };
  }

  it('rejects already manual fulfillment shipments', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: true,
        orderId: 'o1',
        type: 'OUTBOUND',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    await expect(service.reconcileManualFulfillment('s1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFoundException for unknown shipment', async () => {
    const { service } = buildService({ shipment: null });

    await expect(service.reconcileManualFulfillment('missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects reconciling terminal shipment statuses', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'COMPLETED',
        manualFulfillment: false,
        orderId: 'o1',
        type: 'OUTBOUND',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    await expect(service.reconcileManualFulfillment('s1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reconciles courier-tier pending shipment as manual dispatched', async () => {
    const { service, prisma, notificationService } = buildService({
      shipment: {
        id: 's1',
        status: 'DISPATCH_FAILED',
        manualFulfillment: false,
        orderId: 'o1',
        type: 'OUTBOUND',
        pricingTier: 'chowdeck',
        shipmentCharge: 500000,
        pickupCharge: 0,
        vatCharge: 37500,
        providerShipmentId: 'stale-id',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    const result = await service.reconcileManualFulfillment('s1', {
      trackingId: 'RIDER-42',
      actualFulfillmentCostKobo: 420000,
      adminReconcileNote: 'In-house rider',
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Shipment marked as dispatched');
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          status: 'DISPATCHED',
          manualFulfillment: true,
          providerShipmentId: null,
          trackingId: 'RIDER-42',
          actualFulfillmentCostKobo: 420000,
          adminReconcileNote: 'In-house rider',
          reconciledAsManualAt: expect.any(Date),
        }),
      }),
    );
    expect(notificationService.createNotification).toHaveBeenCalled();
  });

  it('trims blank optional strings to null and omits unset optional fields', async () => {
    const { service, prisma } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: false,
        orderId: 'o1',
        type: 'OUTBOUND',
        pricingTier: 'chowdeck',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    await service.reconcileManualFulfillment('s1', {
      trackingId: '   ',
      trackingUrl: '',
      adminReconcileNote: '  ',
    });

    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: expect.objectContaining({
        trackingId: null,
        providerTrackingUrl: null,
        adminReconcileNote: null,
      }),
    });
    const updateData = prisma.shipment.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('actualFulfillmentCostKobo');
  });

  it('does not leak ops jargon in customer-facing reconcile notifications', async () => {
    const { service, notificationService } = buildService({
      shipment: {
        id: 's1',
        status: 'DISPATCH_FAILED',
        manualFulfillment: false,
        orderId: 'o1',
        type: 'OUTBOUND',
        pricingTier: 'chowdeck',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    await service.reconcileManualFulfillment('s1', { trackingId: 'R-1' });

    const payload = notificationService.createNotification.mock.calls[0][0];
    const customerText = customerFacingNotificationText(payload);
    expect(customerText).not.toMatch(/manual fulfillment|reconciled|reconcile/);
    expect(payload.metadata?.reconciledAsManual).toBe(true);
  });

  it('uses carrier-friendly copy for return reconcile notifications', async () => {
    const windowStart = new Date('2026-09-05T08:00:00.000Z');
    const windowEnd = new Date('2026-09-05T12:00:00.000Z');
    const { service, notificationService } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: false,
        orderId: 'o1',
        type: 'RETURN',
        pricingTier: 'chowdeck',
        scheduledWindowStart: windowStart,
        scheduledWindowEnd: windowEnd,
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    await service.reconcileManualFulfillment('s1', {});

    const payload = notificationService.createNotification.mock.calls[0][0];
    expect(payload.type).toBe('RETURN_DISPATCHED');
    expect(customerFacingNotificationText(payload)).not.toMatch(
      /manual fulfillment|reconciled/,
    );
    expect(payload.emailData?.emailHeading).toBe('Return booked with courier');
  });
});

describe('ShipmentService.switchToManualFulfillment', () => {
  function buildService(deps: {
    shipment?: Record<string, unknown> | null;
  }) {
    const prisma = {
      shipment: {
        findUnique: jest.fn().mockResolvedValue(deps.shipment ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const shipmentQuoteService = {} as ShipmentQuoteService;
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ShipmentService(
      prisma as any,
      { add: jest.fn() } as any,
      notificationService as any,
      shipmentQuoteService,
    );
    return { service, prisma, notificationService };
  }

  it('rejects already manual fulfillment shipments', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'PENDING',
        manualFulfillment: true,
        reconciledAsManualAt: null,
        orderId: 'o1',
        type: 'OUTBOUND',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    await expect(service.switchToManualFulfillment('s1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFoundException for unknown shipment', async () => {
    const { service } = buildService({ shipment: null });

    await expect(service.switchToManualFulfillment('missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects switching terminal shipment statuses', async () => {
    const { service } = buildService({
      shipment: {
        id: 's1',
        status: 'DISPATCHED',
        manualFulfillment: false,
        reconciledAsManualAt: null,
        orderId: 'o1',
        type: 'OUTBOUND',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    await expect(service.switchToManualFulfillment('s1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('switches courier-tier pending shipment to Relisted dispatch without dispatching', async () => {
    const { service, prisma, notificationService } = buildService({
      shipment: {
        id: 's1',
        status: 'DISPATCH_FAILED',
        manualFulfillment: false,
        reconciledAsManualAt: null,
        orderId: 'o1',
        type: 'OUTBOUND',
        providerShipmentId: 'stale-id',
        trackingId: 'TRK-1',
        order: { orderId: 'ORD-1', user: { id: 'u1', email: 'a@b.com', name: 'A' } },
      },
    });

    const result = await service.switchToManualFulfillment('s1', {
      adminReconcileNote: '  Ops rider  ',
    });

    expect(result.message).toBe('Switched to Relisted dispatch');
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        status: 'PENDING',
        manualFulfillment: true,
        providerShipmentId: null,
        providerTrackingUrl: null,
        trackingId: null,
        adminReconcileNote: 'Ops rider',
      },
    });
    expect(notificationService.createNotification).not.toHaveBeenCalled();
  });
});
