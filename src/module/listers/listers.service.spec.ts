import { Test, TestingModule } from '@nestjs/testing';
import { ListersService } from './listers.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { WemaServiceService } from 'src/services/wema-service/wema-service.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { UploadService } from '../upload/upload.service';
import { ProductAvailabilityNotifyService } from 'src/services/product-availability-notify/product-availability-notify.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

const mockPrisma = {
  order: { findUnique: jest.fn(), update: jest.fn() },
  orderItem: { findFirst: jest.fn() },
  returnRequest: { update: jest.fn() },
  dispute: { findFirst: jest.fn() },
  product: { update: jest.fn() },
  escrow: { update: jest.fn(), count: jest.fn() },
  wallet: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  walletTransaction: { create: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  upload: { findUnique: jest.fn() },
  availabilityRequest: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotificationService = {
  createNotification: jest.fn().mockResolvedValue({}),
};

const mockProductAvailabilityNotify = {
  notifyWatchersProductAvailable: jest.fn().mockResolvedValue(undefined),
};

describe('ListersService — multi-lister return receipt', () => {
  let service: ListersService;

  const listerA = 'lister-a';
  const listerB = 'lister-b';
  const orderId = 'order-internal-id';

  const baseOrder = {
    id: orderId,
    orderId: 'ORD-MULTI',
    userId: 'renter-1',
    status: OrderStatus.RETURN_DUE,
    user: { id: 'renter-1', email: 'renter@test.com', name: 'Renter' },
    shipments: [
      { id: 'ret-a', type: 'RETURN', listerId: listerA },
      { id: 'ret-b', type: 'RETURN', listerId: listerB },
    ],
    returnRequests: [
      {
        id: 'rr-a',
        shipmentId: 'ret-a',
        status: 'PENDING_PICKUP',
        damageNotes: null,
      },
      {
        id: 'rr-b',
        shipmentId: 'ret-b',
        status: 'PENDING_PICKUP',
        damageNotes: null,
      },
    ],
    orderItems: [
      {
        productId: 'prod-a',
        days: 3,
        product: { curatorId: listerA, listingType: 'RENTAL' },
      },
      {
        productId: 'prod-b',
        days: 3,
        product: { curatorId: listerB, listingType: 'RENTAL' },
      },
    ],
    escrows: [
      {
        id: 'esc-a',
        listerId: listerA,
        status: 'LOCKED',
        collateralAmount: 10000,
        rentalAmount: 5000,
        cleaningFee: 500,
        resaleAmount: 0,
      },
      {
        id: 'esc-b',
        listerId: listerB,
        status: 'LOCKED',
        collateralAmount: 12000,
        rentalAmount: 6000,
        cleaningFee: 600,
        resaleAmount: 0,
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WemaServiceService, useValue: {} },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: MailService, useValue: {} },
        { provide: UploadService, useValue: {} },
        {
          provide: ProductAvailabilityNotifyService,
          useValue: mockProductAvailabilityNotify,
        },
      ],
    }).compile();
    service = module.get<ListersService>(ListersService);

    mockPrisma.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    mockPrisma.dispute.findFirst.mockResolvedValue(null);
    mockPrisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-renter',
      collateralBalance: 25000,
    });
    mockPrisma.wallet.update.mockResolvedValue({});
    mockPrisma.wallet.upsert.mockResolvedValue({ id: 'wallet-lister' });
    mockPrisma.walletTransaction.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: listerA,
      email: 'a@test.com',
      name: 'Lister A',
    });
  });

  function mockTransaction(pendingEscrowsAfter: number) {
    const escrowUpdates: Array<{ where: { id: string } }> = [];
    const orderStatusUpdates: OrderStatus[] = [];
    const productUpdates: string[] = [];

    mockPrisma.$transaction.mockImplementation(async (cb) => {
      const tx = {
        returnRequest: {
          update: jest.fn().mockResolvedValue({
            id: 'rr-a',
            status: 'COMPLETED',
            listerCondition: 'GOOD',
            listerDamageNotes: null,
          }),
        },
        dispute: { findFirst: jest.fn().mockResolvedValue(null) },
        order: {
          update: jest.fn().mockImplementation(({ data }) => {
            orderStatusUpdates.push(data.status);
            return {};
          }),
        },
        product: {
          update: jest.fn().mockImplementation(({ where }) => {
            productUpdates.push(where.id);
            return {};
          }),
        },
        escrow: {
          update: jest.fn().mockImplementation((args) => {
            escrowUpdates.push(args);
            return {};
          }),
          count: jest.fn().mockResolvedValue(pendingEscrowsAfter),
        },
        wallet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'wallet-renter',
            collateralBalance: 25000,
          }),
          update: jest.fn().mockResolvedValue({}),
          upsert: jest.fn().mockResolvedValue({ id: 'wallet-lister' }),
        },
        walletTransaction: { create: jest.fn().mockResolvedValue({}) },
        orderItem: { findMany: jest.fn().mockResolvedValue([]) },
        rental: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        closet: { update: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    return { escrowUpdates, orderStatusUpdates, productUpdates };
  }

  it('confirmReturnReceipt releases only the confirming lister escrow', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(baseOrder);
    const { escrowUpdates, orderStatusUpdates, productUpdates } =
      mockTransaction(1);

    await service.confirmReturnReceipt(listerA, orderId, {
      actualCondition: 'GOOD',
    });

    expect(escrowUpdates).toHaveLength(1);
    expect(escrowUpdates[0].where.id).toBe('esc-a');
    expect(orderStatusUpdates).toContain(OrderStatus.RETURNED);
    expect(orderStatusUpdates).not.toContain(OrderStatus.COMPLETED);
    expect(productUpdates).toEqual(['prod-a']);
    expect(productUpdates).not.toContain('prod-b');
  });

  it('confirmReturnReceipt sets order COMPLETED when all escrows are released', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      ...baseOrder,
      returnRequests: [
        { ...baseOrder.returnRequests[0], status: 'COMPLETED' },
        baseOrder.returnRequests[1],
      ],
      escrows: [
        { ...baseOrder.escrows[0], status: 'RELEASED' },
        baseOrder.escrows[1],
      ],
    });
    const { orderStatusUpdates } = mockTransaction(0);

    await service.confirmReturnReceipt(listerB, orderId, {
      actualCondition: 'GOOD',
    });

    expect(orderStatusUpdates).toContain(OrderStatus.COMPLETED);
  });

  it('confirmReturnReceipt targets the lister-scoped return request', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(baseOrder);
    let updatedReturnId: string | undefined;
    mockPrisma.$transaction.mockImplementation(async (cb) => {
      const tx = {
        returnRequest: {
          update: jest.fn().mockImplementation(({ where }) => {
            updatedReturnId = where.id;
            return {
              id: where.id,
              status: 'COMPLETED',
              listerCondition: 'GOOD',
            };
          }),
        },
        dispute: { findFirst: jest.fn().mockResolvedValue(null) },
        order: { update: jest.fn().mockResolvedValue({}) },
        product: { update: jest.fn().mockResolvedValue({}) },
        escrow: {
          update: jest.fn().mockResolvedValue({}),
          count: jest.fn().mockResolvedValue(1),
        },
        wallet: {
          findUnique: jest.fn().mockResolvedValue({ collateralBalance: 10000 }),
          update: jest.fn().mockResolvedValue({}),
          upsert: jest.fn().mockResolvedValue({}),
        },
        walletTransaction: { create: jest.fn().mockResolvedValue({}) },
        orderItem: { findMany: jest.fn().mockResolvedValue([]) },
        rental: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        closet: { update: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    await service.confirmReturnReceipt(listerB, orderId, {
      actualCondition: 'GOOD',
    });

    expect(updatedReturnId).toBe('rr-b');
  });

  it('confirmReturnReceipt rejects when this lister already released escrow', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      ...baseOrder,
      escrows: [
        { ...baseOrder.escrows[0], status: 'RELEASED' },
        baseOrder.escrows[1],
      ],
    });

    await expect(
      service.confirmReturnReceipt(listerA, orderId, {
        actualCondition: 'GOOD',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('confirmReturnReceipt rejects lister with no matching return request', async () => {
    mockPrisma.orderItem.findFirst.mockResolvedValue({ id: 'oi-b' });
    mockPrisma.order.findUnique.mockResolvedValue({
      ...baseOrder,
      returnRequests: [baseOrder.returnRequests[0]],
      shipments: [baseOrder.shipments[0]],
    });

    await expect(
      service.confirmReturnReceipt(listerB, orderId, {
        actualCondition: 'GOOD',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ListersService.approveOrder', () => {
  let service: ListersService;

  const lister = { id: 'lister-1', name: 'Ada', email: 'l@test.com' };
  const requestId = 'req-approve-1';

  const pendingRequest = {
    id: requestId,
    listerId: lister.id,
    requesterId: 'renter-1',
    productId: 'prod-1',
    rentalDays: 3,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    product: { name: 'Silk dress' },
    requester: { email: 'renter@test.com', name: 'Renter' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CLIENT_URL = 'https://app.relisted.test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WemaServiceService, useValue: {} },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: MailService, useValue: {} },
        { provide: UploadService, useValue: {} },
        {
          provide: ProductAvailabilityNotifyService,
          useValue: mockProductAvailabilityNotify,
        },
      ],
    }).compile();
    service = module.get<ListersService>(ListersService);
  });

  it('throws NotFound when request does not exist', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.approveOrder(lister as never, requestId),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws Forbidden when lister does not own the request', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue({
      ...pendingRequest,
      listerId: 'other-lister',
    });

    await expect(
      service.approveOrder(lister as never, requestId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws Forbidden when request is not pending or expired', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue({
      ...pendingRequest,
      status: 'ACCEPTED',
    });

    await expect(
      service.approveOrder(lister as never, requestId),
    ).rejects.toThrow('not in a state that can be approved');
  });

  it('accepts pending request and notifies renter', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue(pendingRequest);
    mockPrisma.availabilityRequest.update.mockResolvedValue({
      ...pendingRequest,
      status: 'ACCEPTED',
    });

    const result = await service.approveOrder(
      lister as never,
      requestId,
      'Looks good',
    );

    expect(mockPrisma.availabilityRequest.update).toHaveBeenCalledWith({
      where: { id: requestId },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    });
    expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'renter-1',
        title: 'Rental Request Approved',
        type: 'RENTAL_RESPONSE',
        emailData: expect.objectContaining({
          status: 'accepted',
          reason: 'Looks good',
          checkoutLink: 'https://app.relisted.test/shop/cart/checkout',
        }),
      }),
    );
    expect(result).toMatchObject({
      success: true,
      message: 'Order approved successfully',
      data: expect.objectContaining({
        orderId: requestId,
        status: 'approved',
        notes: 'Looks good',
      }),
    });
  });
});

describe('ListersService.rejectOrder', () => {
  let service: ListersService;

  const lister = { id: 'lister-1', name: 'Ada', email: 'l@test.com' };
  const requestId = 'req-reject-1';

  const pendingRequest = {
    id: requestId,
    listerId: lister.id,
    requesterId: 'renter-1',
    productId: 'prod-1',
    rentalDays: 3,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    product: { name: 'Silk dress' },
    requester: { email: 'renter@test.com', name: 'Renter' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WemaServiceService, useValue: {} },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: MailService, useValue: {} },
        { provide: UploadService, useValue: {} },
        {
          provide: ProductAvailabilityNotifyService,
          useValue: mockProductAvailabilityNotify,
        },
      ],
    }).compile();
    service = module.get<ListersService>(ListersService);
  });

  it('throws NotFound when request does not exist', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.rejectOrder(lister as never, requestId, {
        reason: 'Unavailable',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws Forbidden when lister does not own the request', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue({
      ...pendingRequest,
      listerId: 'other-lister',
    });

    await expect(
      service.rejectOrder(lister as never, requestId, {
        reason: 'Unavailable',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws Forbidden when request is not pending or expired', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue({
      ...pendingRequest,
      status: 'ACCEPTED',
    });

    await expect(
      service.rejectOrder(lister as never, requestId, {
        reason: 'Unavailable',
      }),
    ).rejects.toThrow('not in a state that can be rejected');
  });

  it('rejects pending request and notifies renter', async () => {
    mockPrisma.availabilityRequest.findUnique.mockResolvedValue(pendingRequest);
    mockPrisma.availabilityRequest.update.mockResolvedValue({
      ...pendingRequest,
      status: 'REJECTED',
    });

    const result = await service.rejectOrder(lister as never, requestId, {
      reason: 'Item unavailable',
      notes: 'Already booked',
    });

    expect(mockPrisma.availabilityRequest.update).toHaveBeenCalledWith({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        rejectionReason: 'Already booked',
      },
    });
    expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'renter-1',
        title: 'Rental Request Declined',
        type: 'RENTAL_RESPONSE',
        metadata: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
    expect(result).toMatchObject({
      success: true,
      message: 'Order rejected',
      data: expect.objectContaining({
        status: 'rejected',
        reason: 'Item unavailable',
      }),
    });
  });
});

describe('ListersService.rejectReturn', () => {
  let service: ListersService;

  const lister = { id: 'lister-1', name: 'Ada', email: 'l@test.com' };
  const orderId = 'order-internal';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WemaServiceService, useValue: {} },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: MailService, useValue: {} },
        { provide: UploadService, useValue: {} },
        {
          provide: ProductAvailabilityNotifyService,
          useValue: mockProductAvailabilityNotify,
        },
      ],
    }).compile();
    service = module.get<ListersService>(ListersService);

    mockPrisma.orderItem = { findFirst: jest.fn().mockResolvedValue({ id: 'oi-1' }) };
    mockPrisma.returnRequest = { update: jest.fn() };
  });

  it('throws when order or return request is missing', async () => {
    jest.spyOn(service as any, 'ensureOrderBelongsToLister').mockResolvedValue(undefined);
    mockPrisma.order.findUnique.mockResolvedValue(null);

    await expect(
      service.rejectReturn(lister as never, orderId, 'Damaged'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects lister-scoped return and notifies renter', async () => {
    jest.spyOn(service as any, 'ensureOrderBelongsToLister').mockResolvedValue(undefined);
    mockPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      orderId: 'ORD-100',
      userId: 'renter-1',
      user: { email: 'renter@test.com', name: 'Renter' },
      returnRequests: [
        { id: 'rr-1', shipmentId: 'ret-1', status: 'PENDING_PICKUP', damageNotes: null },
      ],
      shipments: [{ id: 'ret-1', type: 'RETURN', listerId: lister.id }],
    });
    mockPrisma.returnRequest.update.mockResolvedValue({
      id: 'rr-1',
      status: 'REJECTED',
    });

    const result = await service.rejectReturn(
      lister as never,
      orderId,
      'Item not returned',
    );

    expect(mockPrisma.returnRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rr-1' },
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
    expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'renter-1',
        type: 'RETURN_REJECTED',
      }),
    );
    expect(result.success).toBe(true);
  });
});
