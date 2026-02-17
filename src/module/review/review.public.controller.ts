import { Controller, Get, Query } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('Public - Reviews')
@Controller('api/public/reviews')
export class ReviewsPublicController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get()
  @ApiOperation({ summary: 'List all reviews (Public)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'sort', required: false })
  @ApiResponse({
    status: 200,
    description: 'Reviews retrieved successfully',
  })
  async findAll(@Query() query: any) {
    // Reuse existing findAll or create a specific public method if needed
    // Existing findAll takes queryDto which has basic filters
    return this.reviewService.findAll(query);
  }
}
