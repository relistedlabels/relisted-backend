import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { RentersService } from './renters.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { WemaServiceService } from 'src/services/wema-service/wema-service.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { TopshipService } from 'src/services/topship/topship.service';
import { ShipbubbleAddressCacheService } from 'src/services/shipbubble/shipbubble-address-cache.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DisputeStatus, ItemCondition } from '@prisma/client';

jest.mock('../order/order-shipment-status.sync', () => ({
  syncOrderStatusFromShipments: jest.fn().mockResolvedValue(undefined),
}));

const mockPrisma = {
  rental: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  favourite: {
    count: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  profile: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  address: {
    upsert: jest.fn(),
  },
  virtualAccounts: {
    findMany: jest.fn(),
  },
  bankAccount: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  walletTransaction: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  withdrawalRequest: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  cart: {
    findUnique: jest.fn(),
  },
  cartItem: {
    findUnique: jest.fn(),
  },
  availabilityRequest: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orderItem: {
    create: jest.fn(),
  },
  dispute: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  notificationSettings: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  transaction: jest.fn(),
  $transaction: jest.fn(),
  product: {
    findUnique: jest.fn(),
  },
  returnRequest: {
    create: jest.fn(),
  },
  shipment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  upload: {
    findUnique: jest.fn(),
  },
};

const mockUploadService = {
  uploadFile: jest.fn(),
};

const mockWemaService = {
  createAccount: jest.fn(),
};

const mockNotificationService = {
  createNotification: jest.fn().mockResolvedValue({}),
};

const mockMailService = {
  sendMail: jest.fn().mockResolvedValue(undefined),
};

const mockTopshipService = {};

const mockShipbubbleAddressCache = {};

const mockUser = {
  id: 'renter-uuid',
  email: 'renter@test.com',
  name: 'Test Renter',
};

describe('RentersService', () => {
  let service: RentersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UploadService, useValue: mockUploadService },
        { provide: WemaServiceService, useValue: mockWemaService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: MailService, useValue: mockMailService },
        { provide: TopshipService, useValue: mockTopshipService },
        {
          provide: getQueueToken('shipment-dispatch'),
          useValue: { add: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ShipbubbleAddressCacheService,
          useValue: mockShipbubbleAddressCache,
        },
      ],
    }).compile();
    service = module.get<RentersService>(RentersService);

    mockPrisma.availabilityRequest.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.availabilityRequest.findFirst.mockResolvedValue(null);
    mockPrisma.availabilityRequest.findMany.mockResolvedValue([]);
    mockPrisma.cart.findUnique.mockResolvedValue(null);
    mockPrisma.dispute.findFirst.mockResolvedValue(null);
    const txImpl = (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(mockPrisma);
    };
    mockPrisma.transaction.mockImplementation(txImpl);
    mockPrisma.$transaction.mockImplementation(txImpl);
  });

  describe('getDashboardSummary()', () => {
    it('should return dashboard summary for renter', async () => {
      mockPrisma.rental.findMany.mockResolvedValue([
        {
          id: 'rental-1',
          product: { name: 'Designer Dress' },
          curator: { name: 'Lister' },
          order: { orderId: 'ORD-001' },
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-05'),
        },
      ]);
      mockPrisma.rental.count.mockResolvedValue(0);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        availableBalance: 10000,
        mainBalance: 10000,
        collateralBalance: 0,
      });
      mockPrisma.favourite.count.mockResolvedValue(5);

      const result = await service.getDashboardSummary(mockUser.id);

      expect(result.success).toBe(true);
      expect(result.data.dashboard.activeRentals.count).toBe(1);
      expect(result.data.dashboard.walletBalance.amount).toBe(10000);
    });
  });

  describe('getProfile()', () => {
    it('should return renter profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        name: 'Test Renter',
        email: 'renter@test.com',
        role: 'RENTER',
        createdAt: new Date(),
        profile: {
          phoneNumber: '08012345678',
          avatarUpload: { url: 'avatar.jpg' },
        },
        virtualAccounts: [],
        bankAccounts: [],
      });

      const result = await service.getProfile(mockUser.id);

      expect(result.success).toBe(true);
      expect(result.data.profile.fullName).toBe('Test Renter');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile()', () => {
    it('should update renter profile', async () => {
      mockPrisma.user.update.mockResolvedValue({
        id: mockUser.id,
        name: 'Updated Name',
        email: 'renter@test.com',
        role: 'RENTER',
        profile: { phoneNumber: '08012345678' },
        virtualAccounts: [],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        name: 'Updated Name',
        email: 'renter@test.com',
        profile: { phoneNumber: '08012345678' },
        virtualAccounts: [],
        bankAccounts: [],
      });

      const result = await service.updateProfile(mockUser.id, {
        fullName: 'Updated Name',
      });

      expect(result.success).toBe(true);
    });

    it('should create virtual account when BVN is provided', async () => {
      mockPrisma.user.update.mockResolvedValue({
        id: mockUser.id,
        name: 'Test',
        virtualAccounts: [],
        profile: { bvn: '12345678901' },
      });
      mockWemaService.createAccount.mockResolvedValue({
        vaNumber: '6980000000',
      });

      await service.updateProfile(mockUser.id, { bvn: '12345678901' });

      expect(mockWemaService.createAccount).toHaveBeenCalled();
    });
  });

  describe('getWallet()', () => {
    it('should return wallet info', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: mockUser.id,
        availableBalance: 5000,
        mainBalance: 10000,
        collateralBalance: 5000,
        updatedAt: new Date(),
        transactions: [],
      });
      mockPrisma.rental.findMany.mockResolvedValue([]);

      const result = await service.getWallet(mockUser.id);

      expect(result.success).toBe(true);
      expect(result.data.wallet.balance.availableBalance).toBe(5000);
    });

    it('should create wallet if not exists', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        id: 'wallet-1',
        userId: mockUser.id,
        availableBalance: 0,
        mainBalance: 0,
        collateralBalance: 0,
      });
      mockPrisma.rental.findMany.mockResolvedValue([]);

      const result = await service.getWallet(mockUser.id);

      expect(result.success).toBe(true);
    });
  });

  describe('getRentalRequests()', () => {
    it('should return rental requests', async () => {
      const futureDate = new Date(Date.now() + 600000);
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          productId: 'prod-1',
          product: { name: 'Dress', curator: { name: 'Lister' } },
          requesterId: mockUser.id,
          listerId: 'lister-1',
          startDate: new Date(),
          endDate: new Date(),
          rentalDays: 3,
          totalPrice: 15000,
          status: 'PENDING',
          expiresAt: futureDate,
        },
      ]);
      mockPrisma.availabilityRequest.count.mockResolvedValue(1);

      const result = await service.getRentalRequests(mockUser.id, {
        status: 'pending',
      });

      expect(result.success).toBe(true);
      expect(result.data.rentalRequests).toHaveLength(1);
    });
  });

  describe('createRentalRequest()', () => {
    it('should create a rental request', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-1' });
      mockPrisma.availabilityRequest.create.mockResolvedValue({
        id: 'req-1',
        productId: 'prod-1',
        requesterId: mockUser.id,
        listerId: 'lister-1',
        status: 'PENDING',
        startDate: new Date(),
        endDate: new Date(),
        rentalDays: 3,
        totalPrice: 15000,
        product: {
          name: 'Dress',
          curator: { name: 'Lister', email: 'lister@test.com' },
        },
      });
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Renter' });

      const result = await service.createRentalRequest(mockUser.id, {
        productId: 'prod-1',
        listerId: 'lister-1',
        rentalStartDate: '2024-01-01',
        rentalEndDate: '2024-01-04',
        rentalDays: 3,
        estimatedRentalPrice: 15000,
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('pending_lister_approval');
    });
  });

  describe('confirmRentalRequest()', () => {
    it('should acknowledge approved request without creating an order', async () => {
      mockPrisma.availabilityRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        requesterId: mockUser.id,
        status: 'ACCEPTED',
        productId: 'prod-1',
        rentalDays: 3,
        totalPrice: 15000,
        startDate: new Date(),
        endDate: new Date(),
        product: { name: 'Dress', curator: { name: 'Lister' } },
      });

      const result = await service.confirmRentalRequest(
        mockUser.id,
        'req-1',
        {},
      );

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('approved_awaiting_checkout');
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when request not accepted', async () => {
      mockPrisma.availabilityRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        requesterId: mockUser.id,
        status: 'PENDING',
      });

      await expect(
        service.confirmRentalRequest(mockUser.id, 'req-1', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOrders()', () => {
    it('should return renter orders', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        {
          orderId: 'ORD-001',
          status: 'PROCESSING',
          createdAt: new Date(),
          totalAmountPaid: 15000,
          orderItems: [{ product: { name: 'Dress' } }],
          rentals: [],
        },
      ]);
      mockPrisma.order.count.mockResolvedValue(1);

      const result = await service.getOrders(mockUser.id, { status: 'active' });

      expect(result.success).toBe(true);
      expect(result.data.orders).toHaveLength(1);
    });
  });

  describe('getOrder()', () => {
    it('should return order details', async () => {
      const start = new Date('2026-01-10T12:00:00.000Z');
      const end = new Date('2026-01-13T12:00:00.000Z');
      mockPrisma.order.findUnique.mockResolvedValue({
        orderId: 'ORD-001',
        status: 'PROCESSING',
        createdAt: new Date(),
        userId: mockUser.id,
        totalAmountPaid: 15000,
        orderItems: [
          {
            productId: 'prod-1',
            product: {
              id: 'prod-1',
              name: 'Dress',
              quantity: 4,
              collateralPrice: 8000,
              originalValue: 10000,
              attachments: { uploads: [{ url: 'img.jpg' }] },
            },
            pricePerDay: 5000,
            days: 3,
            cleaningFee: null,
            collateralFee: null,
            rentalFee: 15000,
          },
        ],
        rentals: [{ productId: 'prod-1', startDate: start, endDate: end }],
        user: { profile: { address: null } },
      });

      const result = await service.getOrder(mockUser.id, 'ORD-001');

      expect(result.success).toBe(true);
      const item = result.data.order.items[0];
      expect(item.quantity).toBe(4);
      expect(item.rentalDays).toBe(3);
      expect(item.cleaningFee).toBe(4000);
      expect(item.collateralFee).toBe(8000);
      expect(item.collateral).toBe(8000);
      expect(item.rentalStartDate).toEqual(start);
      expect(item.rentalEndDate).toEqual(end);
    });

    it('should use availability request dates when no rental row for product', async () => {
      const start = new Date('2026-02-01T00:00:00.000Z');
      const end = new Date('2026-02-04T00:00:00.000Z');
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([
        { productId: 'prod-1', startDate: start, endDate: end },
      ]);
      mockPrisma.order.findUnique.mockResolvedValue({
        orderId: 'ORD-AV',
        status: 'PROCESSING',
        createdAt: new Date(),
        userId: mockUser.id,
        totalAmountPaid: 100,
        orderItems: [
          {
            productId: 'prod-1',
            product: {
              id: 'prod-1',
              name: 'Dress',
              collateralPrice: 0,
              originalValue: 500,
              attachments: { uploads: [] },
            },
            pricePerDay: 10,
            days: 3,
            cleaningFee: 3500,
            collateralFee: 100,
          },
        ],
        rentals: [],
        user: { profile: { address: null } },
      });

      const result = await service.getOrder(mockUser.id, 'ORD-AV');
      const item = result.data.order.items[0];
      expect(item.rentalStartDate).toEqual(start);
      expect(item.rentalEndDate).toEqual(end);
      expect(item.cleaningFee).toBe(3500);
      expect(item.collateralFee).toBe(100);
    });

    it('should default item quantity to 1 when product.quantity is null', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        orderId: 'ORD-002',
        status: 'PROCESSING',
        createdAt: new Date(),
        userId: mockUser.id,
        totalAmountPaid: 100,
        orderItems: [
          {
            productId: 'prod-1',
            product: {
              id: 'prod-1',
              name: 'Dress',
              quantity: null,
              attachments: { uploads: [] },
            },
            pricePerDay: 10,
            days: 1,
          },
        ],
        rentals: [],
        user: { profile: { address: null } },
      });

      const result = await service.getOrder(mockUser.id, 'ORD-002');
      expect(result.data.order.items[0].quantity).toBe(1);
    });

    it('should throw NotFoundException when order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.getOrder(mockUser.id, 'invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('favorites', () => {
    it('should get favorites', async () => {
      mockPrisma.favourite.findMany.mockResolvedValue([
        {
          id: 'fav-1',
          product: { id: 'prod-1', name: 'Dress', images: [] },
          createdAt: new Date(),
        },
      ]);
      mockPrisma.favourite.count.mockResolvedValue(1);

      const result = await service.getFavorites(mockUser.id, {});

      expect(result.success).toBe(true);
      expect(result.data.favorites).toHaveLength(1);
    });

    it('should add to favorites', async () => {
      mockPrisma.favourite.create.mockResolvedValue({
        id: 'fav-1',
        userId: mockUser.id,
        productId: 'prod-1',
      });

      const result = await service.addFavorite(mockUser.id, 'prod-1');

      expect(result).toBeDefined();
    });

    it('should remove from favorites', async () => {
      mockPrisma.favourite.delete.mockResolvedValue({});

      await service.removeFavorite(mockUser.id, 'prod-1');

      expect(mockPrisma.favourite.delete).toHaveBeenCalled();
    });
  });

  describe('disputes', () => {
    it('should get dispute stats', async () => {
      mockPrisma.dispute.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      const result = await service.getDisputeStats(mockUser.id);

      expect(result.success).toBe(true);
      expect(result.data.disputeStats.totalDisputes).toBe(5);
    });

    it('should create a dispute', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        userId: mockUser.id,
        orderId: 'ORD-001',
        status: 'DELIVERED',
        listingType: 'RENTAL',
        deliveredAt: new Date(),
        orderItems: [
          { days: 3, product: { listingType: 'RENTAL' } },
        ],
        shipments: [
          {
            type: 'OUTBOUND',
            status: 'COMPLETED',
            buyerConfirmedAt: null,
            updatedAt: new Date(),
          },
        ],
        disputes: [],
      });
      mockPrisma.dispute.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        name: mockUser.name,
        role: 'RENTER',
      });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'admin-1', name: 'Admin One', email: 'admin1@test.com' },
        { id: 'admin-2', name: 'Admin Two', email: 'admin2@test.com' },
      ]);
      mockPrisma.dispute.create.mockResolvedValue({
        id: 'dispute-1',
        disputeId: 'DSP-001',
        issueCategory: 'damaged',
        status: 'PENDING',
        createdAt: new Date(),
      });

      const result = await service.createDispute(mockUser.id, {
        orderId: 'ORD-001',
        itemId: 'item-1',
        issueCategory: 'damaged',
        description: 'Item was damaged',
        amountDisputed: 5000,
        evidenceFiles: ['upload-1', 'upload-2'],
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachment: {
              create: {
                uploads: {
                  connect: [{ id: 'upload-1' }, { id: 'upload-2' }],
                },
              },
            },
          }),
        }),
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalledTimes(
        2,
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DISPUTE_CREATED' }),
      );
    });

    it('should throw NotFoundException when order not found for dispute', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.createDispute(mockUser.id, {
          orderId: 'invalid',
          itemId: 'item-1',
          issueCategory: 'damaged',
          description: 'Test',
          amountDisputed: 5000,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDisputes()', () => {
    it('should return disputes list', async () => {
      mockPrisma.dispute.findMany.mockResolvedValue([
        {
          disputeId: 'DSP-001',
          issueCategory: 'damaged',
          status: DisputeStatus.PENDING,
          createdAt: new Date(),
          updatedAt: new Date(),
          order: {
            orderId: 'ORD-001',
            orderItems: [{ product: { name: 'Dress' } }],
          },
        },
      ]);
      mockPrisma.dispute.count.mockResolvedValue(1);

      const result = await service.getDisputes(mockUser.id, {});

      expect(result.success).toBe(true);
      expect(result.data.disputes).toHaveLength(1);
    });
  });

  describe('getDisputeById()', () => {
    it('should return dispute details', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        disputeId: 'DSP-001',
        issueCategory: 'damaged',
        status: DisputeStatus.PENDING,
        description: 'Item was damaged',
        order: {
          userId: mockUser.id,
          orderId: 'ORD-001',
          orderItems: [{ product: { name: 'Dress' } }],
        },
        chatRooms: { message: [] },
        createdAt: new Date(),
      });

      const result = await service.getDisputeById(mockUser.id, 'DSP-001');

      expect(result.success).toBe(true);
    });
  });

  describe('notification preferences', () => {
    it('should get notification preferences', async () => {
      mockPrisma.notificationSettings.findUnique.mockResolvedValue({
        emailAlertsEnabled: true,
        marketingEmailsEnabled: true,
        smsUpdatesEnabled: false,
      });

      const result = await service.getNotificationPreferences(mockUser.id);

      expect(result.success).toBe(true);
    });

    it('should update notification preferences', async () => {
      mockPrisma.notificationSettings.findUnique.mockResolvedValue({
        emailAlertsEnabled: true,
        marketingEmailsEnabled: true,
        smsUpdatesEnabled: false,
      });
      mockPrisma.notificationSettings.update.mockResolvedValue({
        emailAlertsEnabled: false,
        marketingEmailsEnabled: true,
        smsUpdatesEnabled: false,
      });

      const result = await service.updateNotificationPreferences(mockUser.id, {
        emailAlerts: false,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('multi-lister returns', () => {
    const futureDay = new Date();
    futureDay.setUTCDate(futureDay.getUTCDate() + 7);
    const y = futureDay.getUTCFullYear();
    const m = String(futureDay.getUTCMonth() + 1).padStart(2, '0');
    const d = String(futureDay.getUTCDate()).padStart(2, '0');
    const futureStart = new Date(`${y}-${m}-${d}T09:00:00.000Z`);
    const futureEnd = new Date(`${y}-${m}-${d}T11:00:00.000Z`);

    const curatorProfile = {
      address: { street: '12 Lister Rd', city: 'Lagos', state: 'Lagos' },
      businessInfo: null,
      phoneNumber: '08011111111',
    };

    function buildMultiListerOrder(
      returnRequests: Array<{ id: string; shipmentId: string }> = [],
    ) {
      return {
        id: 'order-internal-id',
        orderId: 'ORD-MULTI',
        userId: mockUser.id,
        returnRequests,
        orderItems: [
          {
            productId: 'prod-a',
            days: 3,
            product: {
              curator: {
                id: 'lister-a',
                name: 'Lister A',
                email: 'a@test.com',
                profile: curatorProfile,
              },
              resalePrice: 10000,
              originalValue: 10000,
            },
          },
          {
            productId: 'prod-b',
            days: 3,
            product: {
              curator: {
                id: 'lister-b',
                name: 'Lister B',
                email: 'b@test.com',
                profile: curatorProfile,
              },
              resalePrice: 12000,
              originalValue: 12000,
            },
          },
        ],
        user: {
          name: 'Renter',
          email: 'renter@test.com',
          profile: {
            address: { street: 'Renter St', city: 'Lagos', state: 'Lagos' },
          },
        },
        shipments: [
          {
            id: 'ret-a',
            type: 'RETURN',
            listerId: 'lister-a',
            scheduledWindowStart: futureStart,
            scheduledWindowEnd: futureEnd,
            pricingTier: 'chowdeck',
            pickupPartner: 'Standard',
            shipmentCharge: 350000,
            pickupCharge: 100000,
            vatCharge: 25000,
          },
          {
            id: 'ret-b',
            type: 'RETURN',
            listerId: 'lister-b',
            scheduledWindowStart: futureStart,
            scheduledWindowEnd: futureEnd,
            pricingTier: 'chowdeck',
            pickupPartner: 'Standard',
            shipmentCharge: 350000,
            pickupCharge: 100000,
            vatCharge: 25000,
          },
        ],
      };
    }

    it('processReturnWithShipping allows a second return when shipmentId differs', async () => {
      const order = buildMultiListerOrder([
        { id: 'rr-a', shipmentId: 'ret-a' },
      ]);
      mockPrisma.order.findUnique.mockResolvedValue(order);

      const created: Array<{ shipmentId: string | null }> = [];
      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          shipment: {
            findUnique: jest.fn().mockResolvedValue({ id: 'ret-b' }),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
          returnRequest: {
            create: jest.fn().mockImplementation(({ data }) => {
              created.push({ shipmentId: data.shipmentId });
              return { id: 'rr-b', ...data };
            }),
          },
          order: { update: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      await service.processReturnWithShipping(mockUser.id, 'ORD-MULTI', {
        itemCondition: ItemCondition.GOOD,
        shipmentId: 'ret-b',
      });

      expect(created).toHaveLength(1);
      expect(created[0].shipmentId).toBe('ret-b');
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RETURN_INITIATED',
          userId: 'lister-b',
        }),
      );
      expect(mockNotificationService.createNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RETURN_INITIATED',
          userId: 'lister-a',
        }),
      );
    });

    it('processReturnWithShipping rejects duplicate return for same shipmentId', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        buildMultiListerOrder([{ id: 'rr-a', shipmentId: 'ret-a' }]),
      );

      await expect(
        service.processReturnWithShipping(mockUser.id, 'ORD-MULTI', {
          itemCondition: ItemCondition.GOOD,
          shipmentId: 'ret-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('processReturnWithShipping requires shipmentId when multiple RETURN legs exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(buildMultiListerOrder());

      await expect(
        service.processReturnWithShipping(mockUser.id, 'ORD-MULTI', {
          itemCondition: ItemCondition.GOOD,
        }),
      ).rejects.toThrow(/shipmentId is required/i);
    });

    it('processReturnWithShipping reschedules when checkout return window has passed', async () => {
      const pastStart = new Date('2020-01-01T08:00:00+01:00');
      const pastEnd = new Date('2020-01-01T09:00:00+01:00');
      const order = {
        ...buildMultiListerOrder(),
        shipments: [
          {
            id: 'ret-a',
            type: 'RETURN',
            listerId: 'lister-a',
            scheduledWindowStart: pastStart,
            scheduledWindowEnd: pastEnd,
            pricingTier: 'chowdeck',
            pickupPartner: 'Standard',
            shipmentCharge: 350000,
            pickupCharge: 100000,
            vatCharge: 25000,
          },
        ],
      };
      mockPrisma.order.findUnique.mockResolvedValue(order);

      let shipmentUpdateData: Record<string, unknown> | undefined;
      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          shipment: {
            findUnique: jest.fn().mockResolvedValue({ id: 'ret-a' }),
            findFirst: jest.fn(),
            update: jest.fn().mockImplementation(({ data }) => {
              shipmentUpdateData = data;
              return { id: 'ret-a' };
            }),
          },
          returnRequest: {
            create: jest.fn().mockImplementation(({ data }) => ({
              id: 'rr-new',
              ...data,
            })),
          },
          order: { update: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.processReturnWithShipping(
        mockUser.id,
        'ORD-MULTI',
        {
          itemCondition: ItemCondition.GOOD,
          shipmentId: 'ret-a',
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.pickupWindowRescheduled).toBe(true);
      expect(result.data.pickupWindowSummary).toBeTruthy();
      expect(shipmentUpdateData?.scheduledWindowStart).toBeInstanceOf(Date);
      expect(shipmentUpdateData?.scheduledWindowEnd).toBeInstanceOf(Date);
      expect(
        (shipmentUpdateData!.scheduledWindowEnd as Date).getTime(),
      ).toBeGreaterThan(Date.now());
    });

    it('readyToReturn allows second leg after first is submitted', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        buildMultiListerOrder([{ id: 'rr-a', shipmentId: 'ret-a' }]),
      );
      mockPrisma.shipment.findUnique.mockResolvedValue({
        id: 'ret-b',
        orderId: 'order-internal-id',
      });
      mockPrisma.returnRequest.create.mockResolvedValue({
        id: 'rr-b',
        shipmentId: 'ret-b',
      });
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.readyToReturn(
        mockUser.id,
        'ORD-MULTI',
        [],
        { itemCondition: 'GOOD', shipmentId: 'ret-b' },
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shipmentId: 'ret-b' }),
        }),
      );
    });

    it('getOrderProgress exposes returnRequests for each leg', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        userId: mockUser.id,
        status: 'RETURN_DUE',
        totalAmountPaid: 50000,
        listingType: 'RENTAL',
        createdAt: new Date(),
        approvedAt: new Date(),
        dispatchedAt: new Date(),
        deliveredAt: new Date(),
        returnDueAt: new Date(),
        updatedAt: new Date(),
        rentals: [],
        returnRequests: [
          { id: 'rr-a', shipmentId: 'ret-a', status: 'PENDING_PICKUP' },
          { id: 'rr-b', shipmentId: 'ret-b', status: 'PENDING_PICKUP' },
        ],
        orderItems: [
          {
            id: 'oi-a',
            productId: 'prod-a',
            days: 3,
            product: {
              listingType: 'RENTAL',
              name: 'Dress A',
              curator: { id: 'lister-a', profile: {} },
            },
          },
          {
            id: 'oi-b',
            productId: 'prod-b',
            days: 3,
            product: {
              listingType: 'RENTAL',
              name: 'Dress B',
              curator: { id: 'lister-b', profile: {} },
            },
          },
        ],
        shipments: [
          {
            id: 'ob-a',
            type: 'OUTBOUND',
            status: 'COMPLETED',
            listerId: 'lister-a',
            scheduledDate: new Date(),
            scheduledWindowStart: futureStart,
            scheduledWindowEnd: futureEnd,
            trackingId: null,
            providerTrackingUrl: null,
            dispatchedAt: null,
            updatedAt: new Date(),
          },
          {
            id: 'ret-a',
            type: 'RETURN',
            status: 'PENDING',
            listerId: 'lister-a',
            scheduledDate: futureStart,
            scheduledWindowStart: futureStart,
            scheduledWindowEnd: futureEnd,
            trackingId: null,
            providerTrackingUrl: null,
            dispatchedAt: null,
            updatedAt: new Date(),
          },
          {
            id: 'ob-b',
            type: 'OUTBOUND',
            status: 'COMPLETED',
            listerId: 'lister-b',
            scheduledDate: new Date(),
            scheduledWindowStart: futureStart,
            scheduledWindowEnd: futureEnd,
            trackingId: null,
            providerTrackingUrl: null,
            dispatchedAt: null,
            updatedAt: new Date(),
          },
          {
            id: 'ret-b',
            type: 'RETURN',
            status: 'PENDING',
            listerId: 'lister-b',
            scheduledDate: futureStart,
            scheduledWindowStart: futureStart,
            scheduledWindowEnd: futureEnd,
            trackingId: null,
            providerTrackingUrl: null,
            dispatchedAt: null,
            updatedAt: new Date(),
          },
        ],
      });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'lister-a', name: 'Shop A', profile: { businessName: 'Shop A' } },
        { id: 'lister-b', name: 'Shop B', profile: { businessName: 'Shop B' } },
      ]);

      const result = await service.getOrderProgress(mockUser.id, 'ORD-MULTI');

      expect(result.success).toBe(true);
      expect(result.data.returnRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ shipmentId: 'ret-a', status: 'PENDING_PICKUP' }),
          expect.objectContaining({ shipmentId: 'ret-b', status: 'PENDING_PICKUP' }),
        ]),
      );
      const rentalGroups = result.data.shipmentGroups?.filter(
        (g: { kind: string }) => g.kind === 'rental',
      );
      expect(rentalGroups).toHaveLength(2);
    });
  });

  describe('getVerificationStatus()', () => {
    it('should return verified when id document is uploaded', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({
        userId: mockUser.id,
        idDocumentUpload: { id: 'doc-1', createdAt: new Date() },
        bvn: '12345678901',
        idDocumentStatus: 'NOT_UPLOADED',
      });

      const result = await service.getVerificationStatus(mockUser.id);

      expect(result.success).toBe(true);
      expect(result.data.verifications.validId.status).toBe('verified');
      expect(result.data.verifications.bvn.status).toBe('verified');
    });

    it('should return not_verified when no id document uploaded', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({
        userId: mockUser.id,
        idDocumentUpload: null,
        bvn: null,
        idDocumentStatus: 'NOT_UPLOADED',
      });

      const result = await service.getVerificationStatus(mockUser.id);

      expect(result.success).toBe(true);
      expect(result.data.verifications.validId.status).toBe('not_verified');
      expect(result.data.verifications.bvn.status).toBe('not_verified');
    });
  });
});
