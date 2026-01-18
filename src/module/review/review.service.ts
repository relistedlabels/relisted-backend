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
    // Get rental and related order
    const rental = await this.prisma.rental.findUnique({
      where: { id: dto.rentalId },
      include: { order: true, product: true, curator: true, review: true },
    });
    if (!rental) bad('Rental not found');

    if (rental.order.userId !== user.sub) {
      bad('You can only review your own rentals');
    }

    if (
      rental.order.status !== 'COMPLETED' &&
      rental.order.status !== 'DELIVERED'
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
        rental: { connect: { id: dto.rentalId } },
        product: { connect: { id: rental.productId } },
        curator: { connect: { id: rental.curatorId } },
        user: { connect: { id: user.sub } },
      },
    });
  }

  async findAll(user:userEntity) {
     const reviews = await this.prisma.review.findMany({
      where: {curatorId:user.sub},
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
    if (review.userId !== user.sub) bad('You can only update your own review');

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
    if (review.userId !== user.sub) bad('You can only delete your own review');

    await this.prisma.review.delete({ where: { id } });

    return { message: 'Review deleted successfully' };
  }
}
