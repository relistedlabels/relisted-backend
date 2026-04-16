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
    private readonly notificationService: NotificationService,
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
    // Check for an existing EXPIRED request that can be re-requested
    const existingExpired = await this.prisma.availabilityRequest.findFirst({
      where: {
        cartItemId,
        requesterId: user.id,
        status: 'EXPIRED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingExpired) {
      // Verify cart item still exists and belongs to user before reactivating
      const cartItem = await this.prisma.cartItem.findUnique({
        where: { id: cartItemId },
        include: { cart: true },
      });
      if (!cartItem || cartItem.cart.userId !== user.id) {
        bad('Cart item not found');
      }

      // Reactivate expired request - reset to PENDING with new timer
      const expiresAt = addMinutes(new Date(), 15);

      const updated = await this.prisma.availabilityRequest.update({
        where: { id: existingExpired.id },
        data: {
          status: 'PENDING',
          expiresAt,
        },
        include: {
          product: { include: { curator: true } },
        },
      });

      // Notify Lister
      const isResale =
        (updated.product as any)?.listingType === 'RESALE' ||
        ((updated.product as any)?.listingType === 'RENT_OR_RESALE' &&
          updated.rentalDays === 0);
      await this.notificationService.createNotification({
        userId: updated.listerId,
        title: isResale
          ? 'Purchase Request Reactivated'
          : 'Rental Request Reactivated',
        message: `Your ${isResale ? 'purchase' : 'rental'} request for ${updated.product?.name} has been reactivated by ${user.name || 'a user'}.`,
        type: isResale ? 'PURCHASE_REQUEST' : 'RENTAL_REQUEST',
        metadata: { requestId: updated.id, productId: updated.productId },
        sendEmail: true,
        emailData: {
          email: updated.product?.curator?.email,
          listerName: updated.product?.curator?.name,
          renterName: user.name || 'A user',
          productName: updated.product?.name,
          requestId: updated.id,
          rentalDays: existingExpired.rentalDays || 0,
          totalPrice: existingExpired.totalPrice || 0,
          startDate:
            existingExpired.startDate?.toISOString().split('T')[0] || 'TBD',
          endDate:
            existingExpired.endDate?.toISOString().split('T')[0] || 'TBD',
          viewLink: `${process.env.CLIENT_URL}/listers/orders/${updated.id}`,
        },
      });

      return updated;
    }

    // If no expired request, create new (original logic)
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

    // Determine if this is a resale request
    const isResaleRequest =
      (cartItem.product as any)?.listingType === 'RESALE' ||
      ((cartItem.product as any)?.listingType === 'RENT_OR_RESALE' &&
        cartItem.days === 0);

    // If this is a resale request, check if the product is actively rented
    if (isResaleRequest) {
      const activeRental = await this.prisma.rental.findFirst({
        where: {
          productId: cartItem.productId,
          isReturned: false,
          endDate: { gt: new Date() },
        },
      });

      if (activeRental) {
        bad(
          `${cartItem.product.name} is currently rented out and unavailable for resale until ${activeRental.endDate.toISOString().split('T')[0]}`,
        );
      }
    }

    // start 15 minutes countdown NOW
    const expiresAt = addMinutes(new Date(), 15);

    const request = await this.prisma.availabilityRequest.create({
      data: {
        cartItemId,
        productId: cartItem.productId,
        requesterId: user.id,
        listerId: cartItem.product.curatorId,
        expiresAt,
      },
      include: {
        product: { include: { curator: true } },
      },
    });

    // Notify Lister
    await this.notificationService.createNotification({
      userId: request.listerId,
      title: isResaleRequest ? 'New Purchase Request' : 'New Rental Request',
      message: `You have a new ${isResaleRequest ? 'purchase' : 'rental'} request for ${request.product?.name} from ${user.name || 'a user'}.`,
      type: isResaleRequest ? 'PURCHASE_REQUEST' : 'RENTAL_REQUEST',
      metadata: { requestId: request.id, productId: request.productId },
      sendEmail: true,
      emailData: {
        email: request.product?.curator?.email,
        listerName: request.product?.curator?.name,
        renterName: user.name || 'A user',
        productName: request.product?.name,
        requestId: request.id,
        rentalDays: cartItem.days,
        totalPrice: isResaleRequest
          ? (request.product as any)?.resalePrice || 0
          : (request.product?.dailyPrice || 0) * (cartItem.days || 0),
        startDate: 'TBD',
        endDate: 'TBD',
        viewLink: `${process.env.CLIENT_URL}/listers/orders/${request.id}`,
        requestType: isResaleRequest ? 'purchase' : 'rental',
      },
    });

    // Notify Renter
    await this.notificationService.createNotification({
      userId: user.id,
      title: isResaleRequest ? 'Purchase Request Sent' : 'Rental Request Sent',
      message: `Your ${isResaleRequest ? 'purchase' : 'rental'} request for ${request.product?.name} has been sent to the lister.`,
      type: isResaleRequest ? 'PURCHASE_REQUEST_SENT' : 'RENTAL_REQUEST_SENT',
      metadata: { requestId: request.id, productId: request.productId },
      sendEmail: false,
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

    const total = cart.items.reduce((sum, item) => {
      // For resale items (days = 0 for RENT_OR_RESALE means resale), use resalePrice
      const isResaleItem =
        item.product.listingType === 'RESALE' ||
        (item.product.listingType === 'RENT_OR_RESALE' && item.days === 0);
      if (isResaleItem) {
        return sum + (item.product.resalePrice || 0);
      }
      // For rental items, use dailyPrice
      return sum + (item.product.dailyPrice || 0) * item.days;
    }, 0);

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
        title: n.afterApproval
          ? 'Cancelled by renter (after approval)'
          : 'Rental request withdrawn',
        message: n.afterApproval
          ? `The renter cancelled after you approved: ${n.productName}.`
          : `${n.emailData.renterName} withdrew their rental request for ${n.productName}.`,
        type: 'RENTAL_REQUEST',
        metadata: {
          requestId: n.requestId,
          productName: n.productName,
          status: 'CANCELLED_BY_RENTER',
        },
        sendEmail: Boolean(n.emailData.email),
        emailData: n.emailData,
      });
    }

    return { message: 'Item removed from cart' };
  }
}
