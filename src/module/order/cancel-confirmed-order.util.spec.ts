import { BadRequestException } from '@nestjs/common';
import { EscrowStatus, OrderStatus, ShipmentType } from '@prisma/client';
import {
  assertOrderEligibleForAdminCancel,
  cancelConfirmedOrderInTransaction,
} from './cancel-confirmed-order.util';

const baseOrder = {
  id: 'order-internal-1',
  orderId: 'ORD-001',
  userId: 'renter-1',
  status: OrderStatus.CONFIRMED,
  totalAmountPaid: 100000,
  escrows: [
    {
      id: 'escrow-1',
      status: EscrowStatus.LOCKED,
      collateralAmount: 20000,
      resaleReleasedAmount: 0,
    },
  ],
  shipments: [
    {
      id: 'ship-1',
      type: ShipmentType.OUTBOUND,
      status: 'PENDING',
    },
    {
      id: 'ship-2',
      type: ShipmentType.RETURN,
      status: 'PENDING',
    },
  ],
};

describe('cancel-confirmed-order.util', () => {
  describe('assertOrderEligibleForAdminCancel', () => {
    it('allows confirmed orders with pending outbound shipments', () => {
      expect(() => assertOrderEligibleForAdminCancel(baseOrder)).not.toThrow();
    });

    it('blocks orders that have already shipped', () => {
      expect(() =>
        assertOrderEligibleForAdminCancel({
          ...baseOrder,
          shipments: [
            {
              id: 'ship-1',
              type: ShipmentType.OUTBOUND,
              status: 'IN_TRANSIT',
            },
          ],
        }),
      ).toThrow(BadRequestException);
    });

    it('blocks orders with released escrow', () => {
      expect(() =>
        assertOrderEligibleForAdminCancel({
          ...baseOrder,
          escrows: [
            {
              id: 'escrow-1',
              status: EscrowStatus.PARTIALLY_RELEASED,
              collateralAmount: 20000,
              resaleReleasedAmount: 0,
            },
          ],
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('cancelConfirmedOrderInTransaction', () => {
    it('refunds wallet, cancels shipments, and marks order cancelled', async () => {
      const tx: any = {
        shipment: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
        wallet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'wallet-1',
            collateralBalance: 20000,
          }),
          upsert: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        },
        walletTransaction: { create: jest.fn().mockResolvedValue({}) },
        escrow: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        rental: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        orderItem: {
          findMany: jest.fn(async (args: any) => {
            if (args?.where?.days?.gt === 0) {
              return [{ productId: 'product-1' }];
            }
            return [];
          }),
        },
        product: { update: jest.fn().mockResolvedValue({}) },
        order: { update: jest.fn().mockResolvedValue({}) },
      };

      const result = await cancelConfirmedOrderInTransaction(tx, baseOrder);

      expect(result.refundAmount).toBe(100000);
      expect(result.collateralReleased).toBe(20000);
      expect(tx.shipment.updateMany).toHaveBeenCalled();
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 100000,
            note: expect.stringContaining('Refund for cancelled order ORD-001'),
          }),
        }),
      );
      expect(tx.escrow.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: EscrowStatus.REFUNDED },
        }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: OrderStatus.CANCELLED },
        }),
      );
    });
  });
});
