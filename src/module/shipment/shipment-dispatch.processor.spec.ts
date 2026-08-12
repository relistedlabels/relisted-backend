import { ShipmentDispatchProcessor } from './shipment-dispatch.processor';

describe('ShipmentDispatchProcessor — RETURN legs', () => {
  const shipmentId = 'ret-a';
  const orderId = 'order-1';

  function buildProcessor(prisma: {
    shipment: { findUnique: jest.Mock };
    returnRequest: { findFirst: jest.Mock };
    shipmentUpdate: jest.Mock;
  }) {
    const prismaService = {
      shipment: {
        findUnique: prisma.shipment.findUnique,
        update: prisma.shipmentUpdate,
      },
      returnRequest: {
        findFirst: prisma.returnRequest.findFirst,
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
    const findFirst = jest.fn().mockResolvedValue(null);
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
      returnRequest: { findFirst },
      shipmentUpdate,
    });

    await processor.handleDispatch({ data: { shipmentId } } as any);

    expect(findFirst).toHaveBeenCalledWith({
      where: { orderId, shipmentId },
    });
    expect(shipmentUpdate).toHaveBeenCalledWith({
      where: { id: shipmentId },
      data: { status: 'PENDING' },
    });
  });

});
