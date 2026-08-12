import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart-items.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { assertNoOpenAvailabilityRequestForProduct } from 'src/utils/assert-no-open-availability-for-product';

jest.mock('src/utils/assert-no-open-availability-for-product', () => ({
  assertNoOpenAvailabilityRequestForProduct: jest.fn().mockResolvedValue(undefined),
}));

const mockAssertNoOpen = assertNoOpenAvailabilityRequestForProduct as jest.Mock;

const mockPrisma = {
  cartItem: { findUnique: jest.fn(), update: jest.fn() },
  availabilityRequest: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  rental: { findFirst: jest.fn() },
};

const mockNotificationService = {
  createNotification: jest.fn().mockResolvedValue({}),
};

describe('CartService.requestAvailability', () => {
  let service: CartService;

  const user = { id: 'user-1', name: 'Renter One', email: 'renter@test.com' };

  const baseCartItem = {
    id: 'ci-1',
    days: 3,
    productId: 'prod-1',
    cart: { userId: 'user-1' },
    product: {
      id: 'prod-1',
      name: 'Silk dress',
      status: 'AVAILABLE',
      listingType: 'RENTAL',
      dailyPrice: 5000,
      curatorId: 'lister-1',
      curator: { id: 'lister-1', email: 'l@test.com', name: 'Ada' },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CLIENT_URL = 'https://app.relisted.test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    mockPrisma.rental.findFirst.mockResolvedValue(null);
    mockPrisma.availabilityRequest.findFirst.mockResolvedValue(null);
  });

  it('rejects when cart item is missing or not owned by renter', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue(null);

    await expect(
      service.requestAvailability('ci-1', user as never),
    ).rejects.toThrow(BadRequestException);

    mockPrisma.cartItem.findUnique.mockResolvedValue({
      ...baseCartItem,
      cart: { userId: 'other-user' },
    });

    await expect(
      service.requestAvailability('ci-1', user as never),
    ).rejects.toThrow('Cart item not found');
  });

  it('rejects when product is sold', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({
      ...baseCartItem,
      product: { ...baseCartItem.product, status: 'SOLD' },
    });

    await expect(
      service.requestAvailability('ci-1', user as never),
    ).rejects.toThrow('has been sold');
  });

  it('creates a new availability request and notifies lister and renter', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue(baseCartItem);

    const createdRequest = {
      id: 'req-new',
      listerId: 'lister-1',
      productId: 'prod-1',
      rentalDays: 3,
      product: baseCartItem.product,
    };
    mockPrisma.availabilityRequest.create.mockResolvedValue(createdRequest);

    const result = await service.requestAvailability('ci-1', user as never);

    expect(mockAssertNoOpen).toHaveBeenCalledWith(
      mockPrisma,
      user.id,
      baseCartItem.productId,
    );
    expect(mockPrisma.availabilityRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cartItemId: 'ci-1',
          requesterId: user.id,
          listerId: 'lister-1',
          rentalDays: 3,
          totalPrice: 15000,
        }),
      }),
    );
    expect(mockNotificationService.createNotification).toHaveBeenCalledTimes(2);
    expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'lister-1',
        type: 'RENTAL_REQUEST',
        title: 'New Rental Request',
      }),
    );
    expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        type: 'RENTAL_REQUEST_SENT',
      }),
    );
    expect(result).toMatchObject({
      message: 'Availability request sent. Awaiting curator response.',
    });
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('reactivates an expired request instead of creating a new one', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue(baseCartItem);

    const expired = {
      id: 'req-expired',
      status: 'EXPIRED',
      rentalDays: 3,
      totalPrice: 15000,
      startDate: new Date('2026-05-10T00:00:00.000Z'),
      endDate: new Date('2026-05-12T00:00:00.000Z'),
      outboundWindowStart: new Date(Date.now() + 86400000),
      outboundWindowEnd: new Date(Date.now() + 90000000),
      returnWindowStart: new Date(Date.now() + 3 * 86400000),
      returnWindowEnd: new Date(Date.now() + 3 * 86400000 + 3600000),
    };
    mockPrisma.availabilityRequest.findFirst.mockResolvedValue(expired);

    const reactivated = {
      ...expired,
      status: 'PENDING',
      product: baseCartItem.product,
      listerId: 'lister-1',
    };
    mockPrisma.availabilityRequest.update.mockResolvedValue(reactivated);

    const result = await service.requestAvailability('ci-1', user as never);

    expect(mockAssertNoOpen).not.toHaveBeenCalled();
    expect(mockPrisma.availabilityRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.availabilityRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-expired' },
        data: expect.objectContaining({
          status: 'PENDING',
          approvedAt: null,
        }),
      }),
    );
    expect(mockNotificationService.createNotification).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'lister-1',
        title: 'Rental Request Reactivated',
        type: 'RENTAL_REQUEST',
      }),
    );
    expect(result).toEqual(reactivated);
  });

  it('rejects resale request when product is actively rented', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({
      ...baseCartItem,
      days: 0,
      product: {
        ...baseCartItem.product,
        listingType: 'RESALE',
        status: 'AVAILABLE',
      },
    });
    mockPrisma.rental.findFirst.mockResolvedValue({
      id: 'rental-active',
      endDate: new Date(Date.now() + 86400000),
    });

    await expect(
      service.requestAvailability('ci-1', user as never),
    ).rejects.toThrow('currently rented out');
  });

  it('propagates duplicate open request guard', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue(baseCartItem);
    mockAssertNoOpen.mockRejectedValueOnce(
      new BadRequestException(
        'You already have a pending availability request for this product.',
      ),
    );

    await expect(
      service.requestAvailability('ci-1', user as never),
    ).rejects.toThrow('pending availability request');
  });
});

describe('CartService.updateCartItem', () => {
  let service: CartService;
  const user = { id: 'user-1', name: 'Renter', email: 'renter@test.com' };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();
    service = module.get<CartService>(CartService);
  });

  it('updates rental days for owned cart item', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({
      id: 'ci-1',
      days: 3,
      cart: { userId: user.id },
    });
    mockPrisma.cartItem.update.mockResolvedValue({ id: 'ci-1', days: 5 });

    const result = await service.updateCartItem(
      'ci-1',
      { days: 5 },
      user as never,
    );

    expect(mockPrisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { days: 5 },
    });
    expect(result.days).toBe(5);
  });

  it('rejects update when cart item not owned', async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({
      id: 'ci-1',
      cart: { userId: 'other-user' },
    });

    await expect(
      service.updateCartItem('ci-1', { days: 5 }, user as never),
    ).rejects.toThrow('Cart item not found');
  });
});
