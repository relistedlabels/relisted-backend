import { ShipmentDispatchProcessor } from './shipment-dispatch.processor';

describe('ShipmentDispatchProcessor — RETURN legs', () => {
  const shipmentId = 'ret-a';
  const orderId = 'order-1';

  function buildProcessor(prisma: {
    shipment: { findUnique: jest.Mock };
    returnRequest: { findMany: jest.Mock };
    shipmentUpdate: jest.Mock;
  }) {
    const prismaService = {
      shipment: {
        findUnique: prisma.shipment.findUnique,
        update: prisma.shipmentUpdate,
      },
      returnRequest: {
        findMany: prisma.returnRequest.findMany,
      },
    };
    return new ShipmentDispatchProcessor(
      prismaService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('skips RETURN dispatch when no return request exists for that shipmentId', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const shipmentUpdate = jest.fn().mockResolvedValue({});
    const processor = buildProcessor({
      shipment: {
        findUnique: jest.fn().mockResolvedValue({
          id: shipmentId,
          orderId,
          type: 'RETURN',
          status: 'DISPATCHING',
          manualFulfillment: false,
          dispatchAttempts: 0,
          order: { id: orderId },
        }),
      },
      returnRequest: { findMany },
      shipmentUpdate,
    });

    await processor.handleDispatch({ data: { shipmentId } } as any);

    expect(findMany).toHaveBeenCalledWith({
      where: { orderId },
      select: { shipmentId: true },
    });
    expect(shipmentUpdate).toHaveBeenCalledWith({
      where: { id: shipmentId },
      data: { status: 'PENDING' },
    });
  });

});
