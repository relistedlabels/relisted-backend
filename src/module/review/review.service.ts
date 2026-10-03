import { Injectable } from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { userEntity } from '../auth/auth.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';

const REVIEWABLE_ORDER_STATUSES = new Set([
  'COMPLETED',
  'DELIVERED',
  'RETURNED',
  'RETURN_DUE',
  'ACTIVE',
]);

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  private visiblePublicReviewWhere(extra: Record<string, unknown> = {}) {
    return { hiddenAt: null, ...extra };
  }

  private mapPublicReview(r: {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    user: {
      name: string;
      profile?: { avatarUpload?: { url: string | null } | null } | null;
    };
    product?: { name?: string | null } | null;
  }) {
    return {
      id: r.id,
      name: r.user.name,
      renterName: r.user.name,
      avatarUrl: r.user.profile?.avatarUpload?.url || null,
      rating: r.rating,
      comment: r.comment,
      text: r.comment,
      date: r.createdAt,
      productName: r.product?.name ?? null,
      isMostHelpful: r.rating === 5 && (r.comment?.length ?? 0) > 50,
    };
  }

  private reviewOrderBy(sort?: string) {
    if (sort === 'oldest') return { createdAt: 'asc' as const };
    if (sort === 'rating_high') return { rating: 'desc' as const };
    if (sort === 'rating_low') return { rating: 'asc' as const };
    return { createdAt: 'desc' as const };
  }

  async create(dto: CreateReviewDto, user: userEntity) {
    let rentalId = dto.rentalId;
    let rental = rentalId
      ? await this.prisma.rental.findUnique({
          where: { id: rentalId },
          include: { order: true, product: true, curator: true, review: true },
        })
      : null;

    if (!rental && dto.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { orderId: dto.orderId },
        include: { rentals: true, orderItems: { include: { product: true } } },
      });
      if (!order) bad('Order not found');
      if (order.userId !== user.id) bad('You can only review your own orders');

      if (order.rentals.length > 0) {
        rentalId = order.rentals[0].id;
        rental = await this.prisma.rental.findUnique({
          where: { id: rentalId },
          include: { order: true, product: true, curator: true, review: true },
        });
      } else if (REVIEWABLE_ORDER_STATUSES.has(order.status)) {
        const firstItem = order.orderItems[0];
        rental = await this.prisma.rental.create({
          data: {
            orderId: order.id,
            userId: user.id,
            productId: firstItem.productId,
            curatorId: firstItem.product.curatorId,
            days: firstItem.days,
            totalAmount: firstItem.rentalFee || 0,
            startDate: order.deliveredAt || order.createdAt,
            endDate: order.returnDueAt || order.createdAt,
          },
          include: { order: true, product: true, curator: true, review: true },
        });
        rentalId = rental.id;
      }
    }

    if (!rental) bad('Rental not found for this order');

    if (rental.order.userId !== user.id) {
      bad('You can only review your own rentals');
    }

    if (!REVIEWABLE_ORDER_STATUSES.has(rental.order.status)) {
      bad('Cannot review before completing the transaction');
    }

    if (rental.review) {
      bad('Review already submitted for this product');
    }

    return this.prisma.review.create({
      data: {
        rating: dto.rating,
        comment: dto.comment,
        rental: { connect: { id: rentalId } },
        product: { connect: { id: rental.productId } },
        curator: { connect: { id: rental.curatorId } },
        user: { connect: { id: user.id } },
      },
    });
  }

  async findAll(user: userEntity) {
    const reviews = await this.prisma.review.findMany({
      where: { curatorId: user.id },
      include: { product: true, user: true, rental: true },
    });
    if (!reviews) bad('Review not found');
    return {
      message: reviews,
    };
  }

  async findPublicReviews(query: Record<string, unknown>) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 50);
    const skip = (page - 1) * limit;
    const minRating = query.minRating ? Number(query.minRating) : undefined;

    const where = this.visiblePublicReviewWhere({
      ...(query.productId ? { productId: String(query.productId) } : {}),
      ...(query.curatorId ? { curatorId: String(query.curatorId) } : {}),
      ...(minRating ? { rating: { gte: minRating } } : {}),
    });

    const [reviews, total, ratingAgg, fiveStarCount] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.reviewOrderBy(String(query.sort ?? '')),
        include: {
          user: {
            select: {
              name: true,
              profile: { select: { avatarUpload: { select: { url: true } } } },
            },
          },
          product: { select: { name: true } },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({ where, _avg: { rating: true } }),
      this.prisma.review.count({ where: { ...where, rating: 5 } }),
    ]);

    return {
      success: true,
      data: {
        reviews: reviews.map((r) => this.mapPublicReview(r)),
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit) || 1,
          totalItems: total,
          itemsPerPage: limit,
        },
        summary: {
          totalReviews: total,
          averageRating: Math.round((ratingAgg._avg.rating || 0) * 10) / 10,
          fiveStarCount,
        },
      },
    };
  }

  async findPublicProductReviews(productId: string, query: Record<string, unknown>) {
    return this.findPublicReviews({ ...query, productId });
  }

  async adminListReviews(query: Record<string, unknown>) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;
    const search = String(query.search ?? '').trim();
    const visibility = String(query.visibility ?? 'all');

    const where: Record<string, unknown> = {};
    if (visibility === 'hidden') where.hiddenAt = { not: null };
    if (visibility === 'visible') where.hiddenAt = null;
    if (search) {
      where.OR = [
        { comment: { contains: search, mode: 'insensitive' } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { curator: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
          curator: { select: { id: true, name: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      success: true,
      data: {
        reviews: reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          hiddenAt: r.hiddenAt,
          createdAt: r.createdAt,
          product: r.product,
          renter: r.user,
          lister: r.curator,
        })),
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit) || 1,
          totalItems: total,
          itemsPerPage: limit,
        },
      },
    };
  }

  async adminSetReviewHidden(id: string, hidden: boolean) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) bad('Review not found');

    const updated = await this.prisma.review.update({
      where: { id },
      data: { hiddenAt: hidden ? new Date() : null },
    });

    return {
      success: true,
      data: updated,
    };
  }

  async adminRemoveReview(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) bad('Review not found');
    await this.prisma.review.delete({ where: { id } });
    return { success: true, message: 'Review deleted successfully' };
  }

  async findOne(id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: { product: true, curator: true, user: true, rental: true },
    });
    if (!review) bad('Review not found');
    return { message: 'Review fetched successfully', data: review };
  }

  async update(id: string, dto: UpdateReviewDto, user: userEntity) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) bad('Review not found');
    if (review.userId !== user.id) bad('You can only update your own review');

    const updatedReview = await this.prisma.review.update({
      where: { id },
      data: { ...dto },
      include: { product: true, curator: true, user: true, rental: true },
    });

    return { message: 'Review updated successfully', data: updatedReview };
  }

  async remove(id: string, user: userEntity) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) bad('Review not found');
    if (review.userId !== user.id) bad('You can only delete your own review');

    await this.prisma.review.delete({ where: { id } });

    return { message: 'Review deleted successfully' };
  }
}
