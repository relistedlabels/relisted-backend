import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { userEntity } from '../auth/auth.types';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewService } from './review.service';

@ApiBearerAuth('bearer')
@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}
  @Auth()
  @Post()
  @ApiResponse({ status: 201, description: 'Review created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: CreateReviewDto })
  create(
    @Body() createReviewDto: CreateReviewDto,
    @AuthUser() user: userEntity,
  ): Promise<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    productId: string;
    curatorId: string;
    rentalId: string;
  }> {
    return this.reviewService.create(createReviewDto, user);
  }

  @Auth()
  @Get()
  @ApiResponse({ status: 200, description: 'Reviews retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@AuthUser() user: userEntity) {
    return this.reviewService.findAll(user);
  }

  @Auth()
  @Get(':id')
  @ApiResponse({ status: 200, description: 'Review retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findOne(@Param('id') id: string) {
    return this.reviewService.findOne(id);
  }

  @Auth()
  @Patch(':id')
  @ApiResponse({ status: 200, description: 'Review updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @ApiBody({ type: UpdateReviewDto })
  update(
    @Param('id') id: string,
    @Body() updateReviewDto: UpdateReviewDto,
    @AuthUser() user: userEntity,
  ) {
    return this.reviewService.update(id, updateReviewDto, user);
  }

  @Auth()
  @Delete(':id')
  @ApiResponse({ status: 200, description: 'Review deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  remove(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.reviewService.remove(id, user);
  }
}
