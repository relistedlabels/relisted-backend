import { Injectable } from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { userEntity } from '../auth/auth.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

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
      } else if (
        order.status === 'COMPLETED' ||
        order.status === 'DELIVERED' || order.status==="RETURN_DUE"
      ) {
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

    if (
      rental.order.status !== 'COMPLETED' &&
      rental.order.status !== 'DELIVERED' &&
      rental.order.status !== 'RETURNED' &&
      rental.order.status !== 'RETURN_DUE'
    ) {
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

  async findAll(user:userEntity) {
     const reviews = await this.prisma.review.findMany({
      where: {curatorId:user.id},
      include: { product: true, user: true, rental: true },
    });
    if (!reviews) bad('Review not found');
    return {
      message:reviews
    };
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
