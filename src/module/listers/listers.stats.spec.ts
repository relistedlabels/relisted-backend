import { Test, TestingModule } from '@nestjs/testing';
import { ListersService } from './listers.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { WemaServiceService } from 'src/services/wema-service/wema-service.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { UploadService } from '../upload/upload.service';
import { ProductAvailabilityNotifyService } from 'src/services/product-availability-notify/product-availability-notify.service';

const mockUser = { id: 'lister-1', email: 'lister@test.com', role: 'LISTER' };

describe('ListersService.getListerStats', () => {
  let service: ListersService;

  const mockPrisma = {
    walletTransaction: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    escrow: {
      findMany: jest.fn(),
    },
    order: {
      count: jest.fn(),
    },
    rental: {
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WemaServiceService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: UploadService, useValue: {} },
        {
          provide: ProductAvailabilityNotifyService,
          useValue: { notifyWatchersProductAvailable: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ListersService);
  });

  it('uses wallet payout credits for lifetime earnings, not rental start dates', async () => {
    mockPrisma.walletTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 39000 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 39000 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    mockPrisma.escrow.findMany.mockResolvedValue([]);
    mockPrisma.order.count.mockResolvedValue(1);
    mockPrisma.rental.count.mockResolvedValue(0);

    const result = await service.getListerStats(mockUser as any, 'month');

    expect(result.data.totalEarnings.amount).toBe(39000);
    expect(mockPrisma.rental.aggregate).not.toHaveBeenCalled();
    expect(mockPrisma.walletTransaction.aggregate).toHaveBeenCalled();
  });

  it('computes pending payouts from locked and partially released escrow', async () => {
    mockPrisma.walletTransaction.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });
    mockPrisma.escrow.findMany.mockResolvedValue([
      {
        status: 'LOCKED',
        rentalAmount: 30000,
        cleaningFee: 4000,
        collateralAmount: 39000,
        resaleAmount: 0,
      },
      {
        status: 'PARTIALLY_RELEASED',
        rentalAmount: 30000,
        cleaningFee: 4000,
        collateralAmount: 10000,
        resaleAmount: 5000,
      },
    ]);
    mockPrisma.order.count.mockResolvedValue(0);
    mockPrisma.rental.count.mockResolvedValue(0);

    const result = await service.getListerStats(mockUser as any, 'month');

    expect(result.data.pendingPayouts.amount).toBe(73000 + 19000);
  });
});
