import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
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
  $transaction: jest.fn(),
};

const mockNotificationService = {
  createNotification: jest.fn().mockResolvedValue({}),
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
          escrows: {
            id: 'escrow-1',
            curatorId: 'lister-1',
            collateralAmount: 1000,
          },
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
          escrows: {
            id: 'escrow-1',
            curatorId: 'lister-1',
            collateralAmount: 1000,
          },
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
