import { Test, TestingModule } from '@nestjs/testing';
import { WemaServiceService } from './wema-service.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

jest.mock('src/utils/ref.util', () => ({
  generateTransactionRef: jest.fn().mockResolvedValue('REF-TEST-001'),
}));

const mockPrisma = {
  user: { findUnique: jest.fn() },
  virtualAccount: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  transaction: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  walletTransaction: { create: jest.fn() },
};

const mockNotificationService = {
  createNotification: jest.fn().mockResolvedValue({}),
};

describe('WemaServiceService', () => {
  let service: WemaServiceService;

  const user = { id: 'user-1', name: 'Renter', email: 'renter@test.com' };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WemaServiceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<WemaServiceService>(WemaServiceService);
  });

  describe('fundWallet', () => {
    it('creates wallet when missing and credits balances', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        id: 'wallet-1',
        userId: user.id,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        email: user.email,
        name: user.name,
      });

      await service.fundWallet(user.id, 5000);

      expect(mockPrisma.wallet.create).toHaveBeenCalled();
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wallet-1' },
          data: {
            mainBalance: { increment: 5000 },
            availableBalance: { increment: 5000 },
          },
        }),
      );
      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 5000,
            type: 'MAIN',
            status: 'SUCCESS',
          }),
        }),
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });

    it('no-ops for zero or negative amounts', async () => {
      await service.fundWallet(user.id, 0);
      await service.fundWallet(user.id, -100);
      expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('transactionNotify', () => {
    const notifyDto = {
      craccount: '6981234567',
      sessionid: 'sess-abc',
      amount: '7500',
      paymentreference: 'pay-ref',
      originatorname: 'Renter',
      originatoraccountnumber: '0123456789',
      bankname: 'Wema',
      narration: 'Transfer',
      craccountname: 'Relisted',
      bankcode: '035',
    };

    it('returns invalid account for unknown VA', async () => {
      mockPrisma.virtualAccount.findUnique.mockResolvedValue(null);

      const result = await service.transactionNotify(notifyDto);

      expect(result.status).toBe('07');
      expect(result.status_desc).toBe('Invalid Account');
    });

    it('returns existing reference when session id already processed', async () => {
      mockPrisma.virtualAccount.findUnique.mockResolvedValue({
        id: 'va-1',
        userId: user.id,
        status: 'ACTIVE',
      });
      mockPrisma.transaction.findUnique.mockResolvedValue({
        referenceId: 'REF-EXISTING',
      });

      const result = await service.transactionNotify(notifyDto);

      expect(result).toEqual({
        transactionreference: 'REF-EXISTING',
        status: '00',
        status_desc: 'Okay',
      });
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });

    it('creates transaction and funds wallet on first notify', async () => {
      mockPrisma.virtualAccount.findUnique.mockResolvedValue({
        id: 'va-1',
        userId: user.id,
        status: 'ACTIVE',
      });
      mockPrisma.transaction.findUnique.mockResolvedValue(null);
      mockPrisma.transaction.create.mockResolvedValue({
        referenceId: 'REF-TEST-001',
      });
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: user.id,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        email: user.email,
        name: user.name,
      });

      const result = await service.transactionNotify(notifyDto);

      expect(result.status).toBe('00');
      expect(mockPrisma.transaction.create).toHaveBeenCalled();
      expect(mockPrisma.wallet.update).toHaveBeenCalled();
    });
  });

  describe('nameLookup', () => {
    it('returns invalid status for inactive account', async () => {
      mockPrisma.virtualAccount.findUnique.mockResolvedValue({
        status: 'INACTIVE',
      });

      const result = await service.nameLookup({ accountnumber: '6980000000' });

      expect(result.status).toBe('07');
      expect(result.accountname).toBe('Invalid Account');
    });
  });
});
