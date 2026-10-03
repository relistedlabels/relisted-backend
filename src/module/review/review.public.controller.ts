import { Controller, Get, Param, Query } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('Public - Reviews')
@Controller('api/public')
export class ReviewsPublicController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get('reviews')
  @ApiOperation({ summary: 'List public reviews' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'minRating', required: false })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'curatorId', required: false })
  @ApiResponse({
    status: 200,
    description: 'Reviews retrieved successfully',
  })
  async findAll(@Query() query: Record<string, unknown>) {
    return this.reviewService.findPublicReviews(query);
  }

  @Get('products/:productId/reviews')
  @ApiOperation({ summary: 'List reviews for a product (Public)' })
  async findProductReviews(
    @Param('productId') productId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.reviewService.findPublicProductReviews(productId, query);
  }
}
