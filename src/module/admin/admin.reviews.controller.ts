import {
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ReviewService } from '../review/review.service';

@ApiTags('Admin Reviews')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get()
  @ApiOperation({ summary: 'List reviews for moderation' })
  async listReviews(@Query() query: Record<string, unknown>) {
    return this.reviewService.adminListReviews(query);
  }

  @Put(':reviewId/visibility')
  @ApiOperation({ summary: 'Hide or restore a review' })
  async setVisibility(
    @Param('reviewId') reviewId: string,
    @Body() body: { hidden: boolean },
  ) {
    return this.reviewService.adminSetReviewHidden(reviewId, body.hidden === true);
  }

  @Delete(':reviewId')
  @ApiOperation({ summary: 'Delete a review' })
  async deleteReview(@Param('reviewId') reviewId: string) {
    return this.reviewService.adminRemoveReview(reviewId);
  }
}
