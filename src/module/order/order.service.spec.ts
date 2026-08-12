import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipService } from 'src/services/topship/topship.service';
import { ChowdeckRelayService } from 'src/services/chowdeck-relay/chowdeck-relay.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { ShipbubbleService } from 'src/services/shipbubble/shipbubble.service';
import { OrderService } from './order.service';
import { DEFAULT_CLEANING_FEE_NGN } from 'src/constants/rental-pricing';

const mockNotificationService = {
  createNotification: jest.fn().mockResolvedValue({}),
};

const mockShipmentQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  profile: { findUnique: jest.fn() },
  cart: { findUnique: jest.fn() },
  wallet: { findUnique: jest.fn() },
  availabilityRequest: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  shipment: { updateMany: jest.fn() },
  cartItem: { deleteMany: jest.fn() },
  order: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

function buildRentalCheckoutFixtures() {
  const futureStart = new Date(Date.now() + 3 * 86400000);
  const futureEnd = new Date(futureStart.getTime() + 3600000);
  const returnStart = new Date(Date.now() + 7 * 86400000);
  const returnEnd = new Date(returnStart.getTime() + 3600000);

  const lister = {
    id: 'lister-1',
    name: 'Ada',
    email: 'l@test.com',
    profile: {
      phoneNumber: '08000000000',
      address: {
        street: '1 Lister St',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
      },
    },
  };

  const product = {
    id: 'prod-1',
    name: 'Silk dress',
    listingType: 'RENTAL',
    isActive: true,
    productVerified: true,
    status: 'AVAILABLE',
    dailyPrice: 10000,
    collateralPrice: 50000,
    originalValue: 50000,
    curatorId: lister.id,
    curator: lister,
    attachments: { uploads: [] },
    closetId: null,
  };

  const cartItem = {
    id: 'ci-1',
    days: 3,
    product,
  };

  const acceptedRequest = {
    id: 'req-1',
    cartItemId: 'ci-1',
    startDate: new Date('2026-05-10T00:00:00.000Z'),
    endDate: new Date('2026-05-12T00:00:00.000Z'),
    outboundWindowStart: futureStart,
    outboundWindowEnd: futureEnd,
    returnWindowStart: returnStart,
    returnWindowEnd: returnEnd,
    resaleWindowStart: null,
    resaleWindowEnd: null,
  };

  return { lister, product, cartItem, acceptedRequest, futureStart, futureEnd, returnStart, returnEnd };
}

function buildListerProfile(id: string, name: string) {
  return {
    id,
    name,
    email: `${id}@test.com`,
    profile: {
      phoneNumber: '08000000000',
      address: {
        street: `${id} St`,
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
      },
    },
  };
}

function buildMultiListerRentalFixtures() {
  const windows = {
    futureStart: new Date(Date.now() + 3 * 86400000),
    futureEnd: new Date(Date.now() + 3 * 86400000 + 3600000),
    returnStart: new Date(Date.now() + 7 * 86400000),
    returnEnd: new Date(Date.now() + 7 * 86400000 + 3600000),
  };

  const listerA = buildListerProfile('lister-a', 'Ada');
  const listerB = buildListerProfile('lister-b', 'Bea');

  const productA = {
    id: 'prod-a',
    name: 'Dress A',
    listingType: 'RENTAL',
    isActive: true,
    productVerified: true,
    status: 'AVAILABLE',
    dailyPrice: 8000,
    collateralPrice: 40000,
    originalValue: 40000,
    curatorId: listerA.id,
    curator: listerA,
    attachments: { uploads: [] },
    closetId: null,
  };

  const productB = {
    ...productA,
    id: 'prod-b',
    name: 'Dress B',
    curatorId: listerB.id,
    curator: listerB,
  };

  const cartItemA = { id: 'ci-a', days: 3, product: productA };
  const cartItemB = { id: 'ci-b', days: 2, product: productB };

  const requestA = {
    id: 'req-a',
    cartItemId: 'ci-a',
    startDate: new Date('2026-05-10T00:00:00.000Z'),
    endDate: new Date('2026-05-12T00:00:00.000Z'),
    outboundWindowStart: windows.futureStart,
    outboundWindowEnd: windows.futureEnd,
    returnWindowStart: windows.returnStart,
    returnWindowEnd: windows.returnEnd,
    resaleWindowStart: null,
    resaleWindowEnd: null,
  };

  const requestB = {
    ...requestA,
    id: 'req-b',
    cartItemId: 'ci-b',
  };

  return {
    items: [cartItemA, cartItemB],
    requests: [requestA, requestB],
    listers: [listerA, listerB],
  };
}

function buildMixedCartFixtures() {
  const base = buildRentalCheckoutFixtures();
  const lister = base.lister;

  const resaleProduct = {
    id: 'prod-resale',
    name: 'Bag',
    listingType: 'RENT_OR_RESALE',
    isActive: true,
    productVerified: true,
    status: 'AVAILABLE',
    dailyPrice: 10000,
    resalePrice: 75000,
    collateralPrice: 0,
    originalValue: 80000,
    curatorId: lister.id,
    curator: lister,
    attachments: { uploads: [] },
    closetId: null,
  };

  const resaleStart = new Date(Date.now() + 4 * 86400000);
  const resaleEnd = new Date(resaleStart.getTime() + 3600000);

  const rentalItem = base.cartItem;
  const resaleItem = { id: 'ci-resale', days: 0, product: resaleProduct };

  const resaleRequest = {
    id: 'req-resale',
    cartItemId: 'ci-resale',
    startDate: null,
    endDate: null,
    outboundWindowStart: null,
    outboundWindowEnd: null,
    returnWindowStart: null,
    returnWindowEnd: null,
    resaleWindowStart: resaleStart,
    resaleWindowEnd: resaleEnd,
  };

  return {
    items: [rentalItem, resaleItem],
    requests: [base.acceptedRequest, resaleRequest],
    lister,
  };
}

function buildMultiListerMixedFixtures() {
  const windows = {
    futureStart: new Date(Date.now() + 3 * 86400000),
    futureEnd: new Date(Date.now() + 3 * 86400000 + 3600000),
    returnStart: new Date(Date.now() + 7 * 86400000),
    returnEnd: new Date(Date.now() + 7 * 86400000 + 3600000),
    resaleStart: new Date(Date.now() + 4 * 86400000),
    resaleEnd: new Date(Date.now() + 4 * 86400000 + 3600000),
  };

  const listerA = buildListerProfile('lister-a', 'Ada');
  const listerB = buildListerProfile('lister-b', 'Bea');

  const rentalProduct = {
    id: 'prod-rental-a',
    name: 'Dress A',
    listingType: 'RENTAL',
    isActive: true,
    productVerified: true,
    status: 'AVAILABLE',
    dailyPrice: 8000,
    collateralPrice: 40000,
    originalValue: 40000,
    curatorId: listerA.id,
    curator: listerA,
    attachments: { uploads: [] },
    closetId: null,
  };

  const resaleProduct = {
    id: 'prod-resale-b',
    name: 'Bag B',
    listingType: 'RESALE',
    isActive: true,
    productVerified: true,
    status: 'AVAILABLE',
    resalePrice: 65000,
    collateralPrice: 0,
    originalValue: 70000,
    curatorId: listerB.id,
    curator: listerB,
    attachments: { uploads: [] },
    closetId: null,
  };

  const rentalItem = { id: 'ci-rental-a', days: 3, product: rentalProduct };
  const resaleItem = { id: 'ci-resale-b', days: 0, product: resaleProduct };

  const rentalRequest = {
    id: 'req-rental-a',
    cartItemId: 'ci-rental-a',
    startDate: new Date('2026-05-10T00:00:00.000Z'),
    endDate: new Date('2026-05-12T00:00:00.000Z'),
    outboundWindowStart: windows.futureStart,
    outboundWindowEnd: windows.futureEnd,
    returnWindowStart: windows.returnStart,
    returnWindowEnd: windows.returnEnd,
    resaleWindowStart: null,
    resaleWindowEnd: null,
  };

  const resaleRequest = {
    id: 'req-resale-b',
    cartItemId: 'ci-resale-b',
    startDate: null,
    endDate: null,
    outboundWindowStart: null,
    outboundWindowEnd: null,
    returnWindowStart: null,
    returnWindowEnd: null,
    resaleWindowStart: windows.resaleStart,
    resaleWindowEnd: windows.resaleEnd,
  };

  return {
    items: [rentalItem, resaleItem],
    requests: [rentalRequest, resaleRequest],
    listers: [listerA, listerB],
  };
}

function buildConfirmResaleOrderPayload(options?: {
  mixedWithRental?: boolean;
  shipmentId?: string;
}) {
  const shipmentId = options?.shipmentId ?? 'ship-resale-1';
  const listerId = 'lister-1';

  const resaleProduct = {
    id: 'prod-resale',
    name: 'Bag',
    listingType: 'RESALE',
    resalePrice: 75000,
    curatorId: listerId,
    curator: { id: listerId },
    status: 'AVAILABLE',
  };

  const rentalProduct = {
    id: 'prod-rental',
    name: 'Dress',
    listingType: 'RENTAL',
    curatorId: listerId,
    curator: { id: listerId },
  };

  const orderItems = options?.mixedWithRental
    ? [
        {
          id: 'oi-rental',
          productId: rentalProduct.id,
          days: 3,
          product: rentalProduct,
          outboundShipmentId: 'ship-out-1',
          resaleShipmentId: null,
          resaleListerAmount: null,
        },
        {
          id: 'oi-resale',
          productId: resaleProduct.id,
          days: 0,
          product: resaleProduct,
          resaleShipmentId: shipmentId,
          resaleListerAmount: 75000,
        },
      ]
    : [
        {
          id: 'oi-resale',
          productId: resaleProduct.id,
          days: 0,
          product: resaleProduct,
          resaleShipmentId: shipmentId,
          resaleListerAmount: 75000,
        },
      ];

  const shipments = options?.mixedWithRental
    ? [
        {
          id: 'ship-out-1',
          type: 'OUTBOUND',
          status: 'COMPLETED',
          listerId,
          buyerConfirmedAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'ship-ret-1',
          type: 'RETURN',
          status: 'PENDING',
          listerId,
          buyerConfirmedAt: null,
          updatedAt: new Date(),
        },
        {
          id: shipmentId,
          type: 'RESALE',
          status: 'COMPLETED',
          listerId,
          buyerConfirmedAt: null,
          updatedAt: new Date(),
        },
      ]
    : [
        {
          id: shipmentId,
          type: 'RESALE',
          status: 'COMPLETED',
          listerId,
          buyerConfirmedAt: null,
          updatedAt: new Date(),
        },
      ];

  return {
    id: 'order-internal-1',
    orderId: 'ORD-CONFIRM-1',
    listingType: options?.mixedWithRental ? 'RENT_OR_RESALE' : 'RESALE',
    status: 'IN_TRANSIT',
    totalAmountPaid: 105000,
    orderListers: [{ listerId }],
    orderItems,
    shipments,
  };
}

function buildConfirmRentalOrderPayload(shipmentId = 'ship-out-1') {
  const listerId = 'lister-1';
  const product = {
    id: 'prod-rental',
    name: 'Dress',
    listingType: 'RENTAL',
    curatorId: listerId,
    curator: { id: listerId },
  };

  return {
    id: 'order-internal-1',
    orderId: 'ORD-RENTAL-1',
    listingType: 'RENTAL',
    status: 'DELIVERED',
    orderListers: [{ listerId }],
    orderItems: [
      {
        id: 'oi-1',
        productId: product.id,
        days: 3,
        product,
        outboundShipmentId: shipmentId,
      },
    ],
    shipments: [
      {
        id: shipmentId,
        type: 'OUTBOUND',
        status: 'COMPLETED',
        listerId,
        buyerConfirmedAt: null,
        updatedAt: new Date(),
      },
      {
        id: 'ship-ret-1',
        type: 'RETURN',
        status: 'PENDING',
        listerId,
        buyerConfirmedAt: null,
        updatedAt: new Date(),
      },
    ],
  };
}

function buildConfirmTransactionMock(
  orderPayload: { id: string; orderListers: { listerId: string }[] },
  escrowOverrides?: Partial<{
    rentalAmount: number;
    resaleAmount: number;
    resaleReleasedAmount: number;
    status: string;
  }>,
) {
  const listerId = orderPayload.orderListers[0]?.listerId ?? 'lister-1';

  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: orderPayload.id }]),
    order: {
      findFirst: jest.fn().mockResolvedValue(orderPayload),
      update: jest.fn().mockResolvedValue({}),
    },
    shipment: { update: jest.fn().mockResolvedValue({}) },
    escrow: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'esc-1',
        listerId,
        rentalAmount: escrowOverrides?.rentalAmount ?? 0,
        resaleAmount: escrowOverrides?.resaleAmount ?? 75000,
        resaleReleasedAmount: escrowOverrides?.resaleReleasedAmount ?? 0,
        status: escrowOverrides?.status ?? 'LOCKED',
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    wallet: {
      upsert: jest.fn().mockResolvedValue({ id: 'wallet-lister-1' }),
    },
    walletTransaction: { create: jest.fn().mockResolvedValue({}) },
    product: { update: jest.fn().mockResolvedValue({}) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function buildTransactionMock(overrides?: {
  productFindUnique?: jest.Mock;
  rentalFindFirst?: jest.Mock;
  orderFindFirst?: jest.Mock;
}) {
  let shipmentSeq = 0;
  const tx = {
    wallet: { update: jest.fn().mockResolvedValue({}) },
    walletTransaction: { create: jest.fn().mockResolvedValue({}) },
    product: {
      findUnique:
        overrides?.productFindUnique ??
        jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            id: where.id,
            isActive: true,
            productVerified: true,
            status: 'AVAILABLE',
            name: 'Silk dress',
          }),
        ),
    },
    rental: {
      findFirst: overrides?.rentalFindFirst ?? jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    order: {
      findFirst: overrides?.orderFindFirst ?? jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'order-internal-1',
        orderId: 'ORD-E2E-TEST',
      }),
    },
    orderItem: {
      create: jest.fn().mockImplementation(() =>
        Promise.resolve({ id: `oi-${++shipmentSeq}` }),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    productUpdate: jest.fn().mockResolvedValue({}),
    escrow: { create: jest.fn().mockResolvedValue({}) },
    shipment: {
      create: jest.fn().mockImplementation(() =>
        Promise.resolve({ id: `ship-${++shipmentSeq}` }),
      ),
    },
  };
  tx.product.update = tx.productUpdate;
  return tx;
}

describe('OrderService', () => {
  let service: OrderService;

  const user = {
    id: 'user-1',
    email: 'renter@test.com',
    name: 'Renter',
    phoneNumber: '+2348000000000',
  };

  const renterProfile = {
    userId: user.id,
    address: {
      street: '12 Test St',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.SHIPPING_FULFILLMENT_PROVIDERS = 'disabled_provider';
    process.env.CLIENT_URL = 'https://app.relisted.test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: TopshipService, useValue: {} },
        { provide: ChowdeckRelayService, useValue: {} },
        { provide: ShipbubbleService, useValue: {} },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: MailService, useValue: {} },
        {
          provide: getQueueToken('shipment-dispatch'),
          useValue: mockShipmentQueue,
        },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('groups same-lister resale items on the same Lagos day into one bucket', () => {
    const lister = { id: 'lister-1' };
    const product = {
      listingType: 'RESALE',
      curatorId: lister.id,
      curator: lister,
    };
    const items = [
      {
        id: 'c1',
        days: 0,
        product,
        dispatchWindows: {
          RESALE: {
            start: new Date('2026-05-15T09:09:00+01:00'),
            end: new Date('2026-05-15T10:09:00+01:00'),
          },
        },
      },
      {
        id: 'c2',
        days: 0,
        product,
        dispatchWindows: {
          RESALE: {
            start: new Date('2026-05-15T09:10:00+01:00'),
            end: new Date('2026-05-15T10:10:00+01:00'),
          },
        },
      },
    ];

    const buckets = (service as any).buildShipmentBucketsForLister(items);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].bucketMode).toBe('RESALE');
    expect(buckets[0].items).toHaveLength(2);
  });

  describe('cartItemsApprovedForCheckout', () => {
    const rentalProduct = {
      name: 'Silk dress',
      listingType: 'RENTAL',
      curatorId: 'lister-1',
    };

    const cartItem = {
      id: 'ci-1',
      days: 3,
      product: rentalProduct,
    };

    it('returns enriched items with active accepted dispatch windows', async () => {
      const futureStart = new Date(Date.now() + 2 * 86400000);
      const futureEnd = new Date(Date.now() + 2 * 86400000 + 3600000);
      const returnStart = new Date(Date.now() + 5 * 86400000);
      const returnEnd = new Date(Date.now() + 5 * 86400000 + 3600000);

      mockPrisma.availabilityRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          cartItemId: 'ci-1',
          startDate: new Date('2026-05-10T00:00:00.000Z'),
          endDate: new Date('2026-05-12T00:00:00.000Z'),
          outboundWindowStart: futureStart,
          outboundWindowEnd: futureEnd,
          returnWindowStart: returnStart,
          returnWindowEnd: returnEnd,
          resaleWindowStart: null,
          resaleWindowEnd: null,
        },
      ]);

      const result = await (service as any).cartItemsApprovedForCheckout(
        user.id,
        [cartItem],
      );

      expect(result).toHaveLength(1);
      expect(result[0].dispatchWindows.OUTBOUND).toBeDefined();
      expect(result[0].dispatchWindows.RETURN).toBeDefined();
      expect(mockPrisma.availabilityRequest.update).not.toHaveBeenCalled();
    });

    it('expires request and rejects when dispatch window is stale', async () => {
      const pastStart = new Date(Date.now() - 2 * 86400000);
      const pastEnd = new Date(Date.now() - 86400000);

      mockPrisma.availabilityRequest.findMany.mockResolvedValue([
        {
          id: 'req-expired',
          cartItemId: 'ci-1',
          outboundWindowStart: pastStart,
          outboundWindowEnd: pastEnd,
          returnWindowStart: pastStart,
          returnWindowEnd: pastEnd,
        },
      ]);
      mockPrisma.availabilityRequest.update.mockResolvedValue({});

      await expect(
        (service as any).cartItemsApprovedForCheckout(user.id, [cartItem]),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.availabilityRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-expired' },
        data: { status: 'EXPIRED' },
      });
    });

    it('skips cart lines without an accepted availability request', async () => {
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([]);

      const result = await (service as any).cartItemsApprovedForCheckout(
        user.id,
        [cartItem],
      );

      expect(result).toEqual([]);
    });
  });

  describe('getCheckoutSummary', () => {
    it('requires a delivery address on the renter profile', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ address: null });
      mockPrisma.cart.findUnique.mockResolvedValue({ items: [] });

      await expect(
        service.getCheckoutSummary(user as never),
      ).rejects.toThrow('delivery address');
    });

    it('rejects an empty cart', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({ items: [] });

      await expect(
        service.getCheckoutSummary(user as never),
      ).rejects.toThrow('Cart is empty');
    });

    it('rejects when no cart items are approved for checkout', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        items: [{ id: 'ci-1', days: 3, product: { curatorId: 'l-1' } }],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([]);

      await expect(
        service.getCheckoutSummary(user as never),
      ).rejects.toThrow('No items are approved for checkout');
    });

    it('returns rental totals for an approved single-lister cart', async () => {
      const { cartItem, acceptedRequest, lister } = buildRentalCheckoutFixtures();

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        items: [cartItem],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([acceptedRequest]);

      const result = await service.getCheckoutSummary(user as never);

      expect(result.success).toBe(true);
      expect(result.data?.summary?.rentalTotal).toBe(30000);
      expect(result.data?.summary?.collateralTotal).toBe(50000);
      expect(result.data?.summary?.cleaningTotal).toBe(DEFAULT_CLEANING_FEE_NGN);
      expect(result.data?.listerBreakdowns?.[0]).toMatchObject({
        listerId: lister.id,
        rentalTotal: 30000,
      });
      expect(result.data?.shipmentBuckets?.length).toBeGreaterThan(0);
    });

    it('returns mixed rental and purchase totals for dual listing cart', async () => {
      const { items, requests } = buildMixedCartFixtures();

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart-1', items });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue(requests);

      const result = await service.getCheckoutSummary(user as never);

      expect(result.data?.summary?.rentalTotal).toBe(30000);
      expect(result.data?.summary?.purchaseTotal).toBe(75000);
      expect(result.data?.listerBreakdowns?.[0]?.purchaseTotal).toBe(75000);
    });
  });

  describe('checkout', () => {
    it('requires a delivery address on the renter profile', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ address: null });

      await expect(service.checkout(user as never)).rejects.toThrow(
        'delivery address',
      );
    });

    it('rejects an empty cart', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({ items: [] });

      await expect(service.checkout(user as never)).rejects.toThrow(
        'Cart is empty',
      );
    });

    it('rejects when no cart items are approved for checkout', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        items: [{ id: 'ci-1', days: 3, product: { curatorId: 'l-1' } }],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([]);

      await expect(service.checkout(user as never)).rejects.toThrow(
        'No items are approved for checkout',
      );
    });

    it('creates order, shipments, and debits wallet for approved rental cart', async () => {
      const { cartItem, acceptedRequest } = buildRentalCheckoutFixtures();
      const tx = buildTransactionMock();

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        items: [cartItem],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([acceptedRequest]);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        mainBalance: 500_000,
        availableBalance: 500_000,
      });
      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.checkout(user as never, 'relisted_dispatch');

      expect(result.success).toBe(true);
      expect(result.data?.ordersCreated).toBe(1);
      expect(result.data?.orderIds).toEqual(['ORD-E2E-TEST']);
      expect(result.data?.shipmentIds?.length).toBe(2);
      expect(tx.order.create).toHaveBeenCalled();
      expect(tx.wallet.update).toHaveBeenCalled();
      expect(tx.shipment.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalled();
      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });

    it('rejects checkout when wallet balance is insufficient', async () => {
      const { cartItem, acceptedRequest } = buildRentalCheckoutFixtures();

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        items: [cartItem],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([acceptedRequest]);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        mainBalance: 100,
        availableBalance: 100,
      });

      await expect(
        service.checkout(user as never, 'relisted_dispatch'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates order with escrows for two listers', async () => {
      const { items, requests } = buildMultiListerRentalFixtures();
      const tx = buildTransactionMock();

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart-1', items });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue(requests);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        mainBalance: 1_000_000,
        availableBalance: 1_000_000,
      });
      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.checkout(user as never, 'relisted_dispatch');

      expect(result.success).toBe(true);
      expect(tx.escrow.create).toHaveBeenCalledTimes(2);
      expect(tx.shipment.create).toHaveBeenCalledTimes(4);
    });

    it('creates order with escrows and mixed shipment legs for rental and resale listers', async () => {
      const { items, requests } = buildMultiListerMixedFixtures();
      const tx = buildTransactionMock();

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart-1', items });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue(requests);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        mainBalance: 1_000_000,
        availableBalance: 1_000_000,
      });
      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.checkout(user as never, 'relisted_dispatch');

      expect(result.success).toBe(true);
      expect(result.data?.ordersCreated).toBe(1);
      expect(tx.escrow.create).toHaveBeenCalledTimes(2);
      expect(tx.shipment.create).toHaveBeenCalledTimes(3);
      expect(tx.wallet.update).toHaveBeenCalled();
      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalled();
    });

    it('rolls back when product is sold inside transaction', async () => {
      const { cartItem, acceptedRequest } = buildRentalCheckoutFixtures();
      const tx = buildTransactionMock({
        productFindUnique: jest.fn().mockResolvedValue({
          id: cartItem.product.id,
          isActive: true,
          productVerified: true,
          status: 'SOLD',
          name: cartItem.product.name,
        }),
      });

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        items: [cartItem],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([acceptedRequest]);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        mainBalance: 500_000,
        availableBalance: 500_000,
      });
      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await expect(
        service.checkout(user as never, 'relisted_dispatch'),
      ).rejects.toThrow('already sold');
    });

    it('rolls back when overlapping rental exists', async () => {
      const { cartItem, acceptedRequest } = buildRentalCheckoutFixtures();
      const tx = buildTransactionMock({
        rentalFindFirst: jest.fn().mockResolvedValue({
          id: 'rental-existing',
          endDate: new Date(Date.now() + 86400000),
        }),
      });

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        items: [cartItem],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([acceptedRequest]);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        mainBalance: 500_000,
        availableBalance: 500_000,
      });
      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await expect(
        service.checkout(user as never, 'relisted_dispatch'),
      ).rejects.toThrow('overlapping rental');
    });

    it('rolls back when active resale order already exists', async () => {
      const windows = {
        futureStart: new Date(Date.now() + 4 * 86400000),
        futureEnd: new Date(Date.now() + 4 * 86400000 + 3600000),
      };
      const lister = buildListerProfile('lister-1', 'Ada');
      const product = {
        id: 'prod-resale-only',
        name: 'Bag',
        listingType: 'RESALE',
        isActive: true,
        productVerified: true,
        status: 'AVAILABLE',
        resalePrice: 50000,
        curatorId: lister.id,
        curator: lister,
        attachments: { uploads: [] },
        closetId: null,
      };
      const cartItem = { id: 'ci-resale', days: 0, product };
      const acceptedRequest = {
        id: 'req-resale',
        cartItemId: 'ci-resale',
        outboundWindowStart: null,
        outboundWindowEnd: null,
        returnWindowStart: null,
        returnWindowEnd: null,
        resaleWindowStart: windows.futureStart,
        resaleWindowEnd: windows.futureEnd,
      };

      const tx = buildTransactionMock({
        orderFindFirst: jest.fn().mockResolvedValue({ id: 'existing-order' }),
      });

      mockPrisma.profile.findUnique.mockResolvedValue(renterProfile);
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        items: [cartItem],
      });
      mockPrisma.availabilityRequest.findMany.mockResolvedValue([acceptedRequest]);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        mainBalance: 500_000,
        availableBalance: 500_000,
      });
      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await expect(
        service.checkout(user as never, 'relisted_dispatch'),
      ).rejects.toThrow('pending or completed resale order');
    });
  });

  describe('confirmResaleOrder', () => {
    it('releases escrow and marks resale product sold without completing a mixed rental order', async () => {
      const orderPayload = buildConfirmResaleOrderPayload({
        mixedWithRental: true,
      });
      const tx = buildConfirmTransactionMock(orderPayload, {
        rentalAmount: 30000,
        resaleAmount: 75000,
      });

      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));
      mockPrisma.order.findUnique.mockResolvedValue({
        orderId: orderPayload.orderId,
        status: 'IN_TRANSIT',
        listingType: orderPayload.listingType,
        shipments: orderPayload.shipments,
      });

      const result = await service.confirmResaleOrder(
        user as never,
        orderPayload.orderId,
        { shipmentId: 'ship-resale-1' },
      );

      expect(result.success).toBe(true);
      expect(result.data?.orderCompleted).toBe(false);
      expect(result.data?.shipmentId).toBe('ship-resale-1');
      expect(tx.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ship-resale-1' } }),
      );
      expect(tx.wallet.upsert).toHaveBeenCalled();
      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-resale' },
          data: { status: 'SOLD', isActive: false },
        }),
      );
      expect(tx.order.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'COMPLETED' },
        }),
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Purchase delivery confirmed',
        }),
      );
    });

    it('completes a pure resale order and finalizes escrows', async () => {
      const orderPayload = buildConfirmResaleOrderPayload();
      const tx = buildConfirmTransactionMock(orderPayload, {
        resaleAmount: 75000,
      });

      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));
      mockPrisma.order.findUnique.mockResolvedValue({
        orderId: orderPayload.orderId,
        status: 'COMPLETED',
      });

      const result = await service.confirmResaleOrder(
        user as never,
        orderPayload.orderId,
        { shipmentId: 'ship-resale-1' },
      );

      expect(result.success).toBe(true);
      expect(result.data?.orderCompleted).toBe(true);
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: orderPayload.id },
          data: { status: 'COMPLETED' },
        }),
      );
      expect(tx.escrow.updateMany).toHaveBeenCalled();
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Order completed',
        }),
      );
    });
  });

  describe('confirmRentalOrder', () => {
    it('releases rental escrow and activates the rental period', async () => {
      const orderPayload = buildConfirmRentalOrderPayload();
      const tx = buildConfirmTransactionMock(orderPayload, {
        rentalAmount: 30000,
        resaleAmount: 0,
      });

      mockPrisma.$transaction.mockImplementation(async (cb) => cb(tx));
      mockPrisma.order.findUnique.mockResolvedValue({
        orderId: orderPayload.orderId,
        status: 'ACTIVE',
      });

      const result = await service.confirmRentalOrder(
        user as never,
        orderPayload.orderId,
        { shipmentId: 'ship-out-1' },
      );

      expect(result.success).toBe(true);
      expect(result.data?.rentalActivated).toBe(true);
      expect(result.data?.shipmentId).toBe('ship-out-1');
      expect(tx.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ship-out-1' } }),
      );
      expect(tx.wallet.upsert).toHaveBeenCalled();
      expect(tx.escrow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PARTIALLY_RELEASED' }),
        }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: orderPayload.id },
          data: { status: 'ACTIVE' },
        }),
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rental delivery confirmed',
        }),
      );
    });
  });
});
