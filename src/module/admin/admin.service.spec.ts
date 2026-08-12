import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { BadRequestException } from '@nestjs/common';

const mockPrisma: any = {
  dispute: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  wallet: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
  walletTransaction: {
    create: jest.fn(),
  },
  escrow: {
    update: jest.fn(),
  },
  order: {
    update: jest.fn(),
  },
  shipment: {
    findFirst: jest.fn(),
  },
  orderItem: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  rental: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  product: {
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockNotificationService = {
  createNotification: jest.fn().mockResolvedValue({}),
};

const mockMailService = {
  sendMail: jest.fn().mockResolvedValue(undefined),
};

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: any) =>
      fn(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  describe('resolveDisputeAndSettle', () => {
    it('settles collateral and notifies renter and lister', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        id: 'dispute-db-1',
        disputeId: 'DSP-001',
        order: {
          id: 'order-db-1',
          orderId: 'ORD-001',
          userId: 'renter-1',
          status: 'RETURNED',
          user: { id: 'renter-1', email: 'renter@test.com', name: 'Renter' },
          escrows: [
            {
              id: 'escrow-1',
              listerId: 'lister-1',
              renterId: 'renter-1',
              status: 'LOCKED',
              collateralAmount: 1000,
              rentalAmount: 0,
              cleaningFee: 0,
              resaleAmount: 0,
            },
          ],
          returnRequest: { status: 'COMPLETED' },
        },
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'lister-1',
        name: 'Lister',
        email: 'lister@test.com',
      });

      mockPrisma.wallet.upsert.mockResolvedValue({
        id: 'wallet-renter-1',
        userId: 'renter-1',
        collateralBalance: 1000,
      });

      const res = await service.resolveDisputeAndSettle('dispute-db-1', {
        resolutionDetails: 'Resolved',
        collateralWithheldToLister: 300,
      });

      expect(res.success).toBe(true);

      expect(mockPrisma.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dispute-db-1' },
          data: expect.objectContaining({ status: expect.anything() }),
        }),
      );

      expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wallet-renter-1' },
          data: expect.objectContaining({
            collateralBalance: { decrement: 1000 },
            availableBalance: { increment: 700 },
            mainBalance: { decrement: 300 },
          }),
        }),
      );

      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledTimes(3);
      expect(mockPrisma.escrow.update).toHaveBeenCalled();
      expect(mockNotificationService.createNotification).toHaveBeenCalledTimes(
        2,
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DISPUTE_STATUS' }),
      );
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-db-1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('releases rental products when return shipment is completed but return request is not', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        id: 'dispute-db-1',
        disputeId: 'DQ-9310',
        order: {
          id: 'order-db-1',
          orderId: 'ORD-1782383745917-325',
          userId: 'renter-1',
          status: 'IN_DISPUTE',
          user: { id: 'renter-1', email: 'renter@test.com', name: 'Renter' },
          escrows: [
            {
              id: 'escrow-1',
              listerId: 'lister-1',
              renterId: 'renter-1',
              status: 'LOCKED',
              collateralAmount: 58056,
              rentalAmount: 0,
              cleaningFee: 0,
              resaleAmount: 0,
            },
          ],
          returnRequests: [{ status: 'PENDING_PICKUP' }],
        },
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'lister-1',
        name: 'Lister',
        email: 'lister@test.com',
      });

      mockPrisma.wallet.upsert.mockResolvedValue({
        id: 'wallet-renter-1',
        userId: 'renter-1',
        collateralBalance: 58056,
      });

      mockPrisma.shipment.findFirst.mockResolvedValue({ id: 'return-ship-1' });
      mockPrisma.orderItem.findMany.mockResolvedValue([
        {
          productId: 'product-1',
          product: { listingType: 'RENTAL' },
        },
      ]);

      await service.resolveDisputeAndSettle('dispute-db-1', {
        resolutionDetails: 'Tailor repair deducted from collateral',
        collateralWithheldToLister: 6200,
      });

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { status: 'AVAILABLE' },
      });
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-db-1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('clears IN_DISPUTE on order when return is not completed', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        id: 'dispute-db-1',
        disputeId: 'DQ-3809',
        order: {
          id: 'order-db-1',
          orderId: 'ORD-1780589122009-645',
          userId: 'renter-1',
          status: 'IN_DISPUTE',
          user: { id: 'renter-1', email: 'renter@test.com', name: 'Renter' },
          escrows: [
            {
              id: 'escrow-1',
              listerId: 'lister-1',
              renterId: 'renter-1',
              status: 'LOCKED',
              collateralAmount: 5000,
              rentalAmount: 0,
              cleaningFee: 0,
              resaleAmount: 0,
            },
          ],
          returnRequests: [],
        },
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'lister-1',
        name: 'Lister',
        email: 'lister@test.com',
      });

      mockPrisma.wallet.upsert.mockResolvedValue({
        id: 'wallet-renter-1',
        userId: 'renter-1',
        collateralBalance: 5000,
      });

      await service.resolveDisputeAndSettle('dispute-db-1', {
        resolutionDetails: 'Repair',
        collateralWithheldToLister: 5000,
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-db-1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('throws if wallet collateral is insufficient', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        id: 'dispute-db-1',
        disputeId: 'DSP-001',
        order: {
          id: 'order-db-1',
          orderId: 'ORD-001',
          userId: 'renter-1',
          status: 'RETURNED',
          user: { id: 'renter-1', email: 'renter@test.com', name: 'Renter' },
          escrows: [
            {
              id: 'escrow-1',
              listerId: 'lister-1',
              renterId: 'renter-1',
              status: 'LOCKED',
              collateralAmount: 1000,
              rentalAmount: 0,
              cleaningFee: 0,
              resaleAmount: 0,
            },
          ],
          returnRequest: { status: 'COMPLETED' },
        },
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'lister-1',
        name: 'Lister',
        email: 'lister@test.com',
      });

      mockPrisma.wallet.upsert.mockResolvedValue({
        id: 'wallet-renter-1',
        userId: 'renter-1',
        collateralBalance: 200,
      });

      await expect(
        service.resolveDisputeAndSettle('dispute-db-1', {
          resolutionDetails: 'Resolved',
          collateralWithheldToLister: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
