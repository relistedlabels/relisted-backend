import { Injectable } from '@nestjs/common';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import { addMinutes, differenceInMinutes, isAfter } from 'date-fns';

import { NotificationService } from 'src/services/notification/notification.service';
import { withdrawAvailabilityRequestsForCartItem } from './withdraw-availability-for-cart-item';
import { assertNoOpenAvailabilityRequestForProduct } from 'src/utils/assert-no-open-availability-for-product';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService
  ) {}

  //  create cart for user
  async CreateCart(userId: string) {
    let cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await this.prisma.cart.create({ data: { userId } });
    }
    return cart;
  }

  // Add item to cart
  async addCartItem(dto: CreateCartItemDto, user: userEntity) {
    const cart = await this.CreateCart(user.id);

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    // Prevent duplicate
    const existing = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId: dto.productId },
    });
    if (existing) bad('Product already in cart');

    return this.prisma.cartItem.create({
      data: { cartId: cart.id, productId: dto.productId, days: dto.days },
    });
  }


 async requestAvailability(cartItemId: string, user: userEntity) {
  const cartItem = await this.prisma.cartItem.findUnique({
    where: { id: cartItemId },
    include: {
      product: {
        include: { curator: true },
      },
    },
  });

  if (!cartItem) bad('Cart item not found');

  await assertNoOpenAvailabilityRequestForProduct(
    this.prisma,
    user.id,
    cartItem.productId,
  );

  // start 30 minutes countdown NOW
  const expiresAt = addMinutes(new Date(), 30);

  const request = await this.prisma.availabilityRequest.create({
    data: {
      cartItemId,
      productId: cartItem.productId,
      requesterId: user.id,
      listerId: cartItem.product.curatorId,
      expiresAt,
    },
    include: {
        product: { include: { curator: true } }
    }
  });

  // Notify Lister
  await this.notificationService.createNotification({
      userId: request.listerId,
      title: "New Rental Request",
      message: `You have a new rental request for ${request.product?.name} from ${user.name || 'a user'}.`,
      type: "RENTAL_REQUEST",
      metadata: { requestId: request.id, productId: request.productId },
      sendEmail: true,
      emailData: {
          email: request.product?.curator?.email,
          listerName: request.product?.curator?.name,
          renterName: user.name || 'A user',
          productName: request.product?.name,
          requestId: request.id,
          rentalDays: cartItem.days,
          totalPrice: (request.product?.dailyPrice || 0) * (cartItem.days || 0),
          startDate: 'TBD',
          endDate: 'TBD',
          viewLink: `${process.env.CLIENT_URL}/listers/orders/${request.id}`,
      }
  });

  // Notify Renter
  await this.notificationService.createNotification({
      userId: user.id,
      title: "Rental Request Sent",
      message: `Your rental request for ${request.product?.name} has been sent to the lister.`,
      type: "RENTAL_REQUEST_SENT",
      metadata: { requestId: request.id, productId: request.productId },
      sendEmail: false
  });

  
  return {
    message: 'Availability request sent. Awaiting curator response.',
    expiresAt,
  };
}

// accept request 

async acceptAvailability(requestId: string) {
  const request = await this.prisma.availabilityRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) bad('Request not found');

  if (request.expiresAt < new Date()) {
    await this.prisma.availabilityRequest.update({
      where: { id: requestId },
      data: { status: 'EXPIRED' },
    });
    bad('Request expired');
  }

  return this.prisma.availabilityRequest.update({
    where: { id: requestId },
    data: { status: 'ACCEPTED' },
  });
}


  // Update cart item (rental days)
  async updateCartItem(
    cartItemId: string,
    dto: UpdateCartItemDto,
    user: userEntity,
  ) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== user.id) bad('Cart item not found');

    return this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { days: dto.days },
    });
  }

  
  // Fetch cart with totals
  async getCart(user: userEntity) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId: user.id },
      include: { items: { include: { product: true } } },
    });

    if (!cart) return { items: [], total: 0 };

    const itemIds = cart.items.map((i) => i.id);
    const requests =
      itemIds.length === 0
        ? []
        : await this.prisma.availabilityRequest.findMany({
            where: {
              requesterId: user.id,
              cartItemId: { in: itemIds },
              // Cart shows active requests only; full history is on the renter rental-requests API.
              status: { notIn: ['CANCELLED_BY_RENTER'] },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              cartItemId: true,
              expiresAt: true,
              status: true,
              startDate: true,
              endDate: true,
              rentalDays: true,
              createdAt: true,
            },
          });

    const requestsByCartItemId = new Map<string, typeof requests>();
    for (const r of requests) {
      const list = requestsByCartItemId.get(r.cartItemId) ?? [];
      list.push(r);
      requestsByCartItemId.set(r.cartItemId, list);
    }

    const toSnapshot = (r: (typeof requests)[number]) => ({
      requestId: r.id,
      expiresAt: r.expiresAt,
      status: r.status,
      startDate: r.startDate,
      endDate: r.endDate,
      rentalDays: r.rentalDays,
      createdAt: r.createdAt,
    });

    const items = cart.items.map((item) => {
      const list = requestsByCartItemId.get(item.id) ?? [];
      const snapshots = list.map(toSnapshot);
      return {
        ...item,
        rentalRequests: snapshots,
        rentalRequest: snapshots[0] ?? null,
      };
    });

    const total = cart.items.reduce(
      (sum, item) => sum + item.product.dailyPrice * item.days,
      0,
    );

    return { cartId: cart.id, items, total };
  }

  // Remove cart item
  async removeCartItem(cartItemId: string, user: userEntity) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== user.id) bad('Cart item not found');

    const listerNotifies = await this.prisma.$transaction(async (tx) => {
      const notifies = await withdrawAvailabilityRequestsForCartItem(
        tx,
        cartItemId,
        user.id,
      );
      await tx.cartItem.delete({ where: { id: cartItemId } });
      return notifies;
    });

    for (const n of listerNotifies) {
      await this.notificationService.createNotification({
        userId: n.listerId,
        title: 'Cancelled by renter (after approval)',
        message: `The renter cancelled after you approved: ${n.productName}.`,
        type: 'RENTAL_RESPONSE',
        metadata: {
          requestId: n.requestId,
          productName: n.productName,
          status: 'CANCELLED_BY_RENTER',
        },
        sendEmail: false,
      });
    }

    return { message: 'Item removed from cart' };
  }
}
