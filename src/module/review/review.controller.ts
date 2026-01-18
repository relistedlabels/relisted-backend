import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { userEntity } from '../auth/auth.types';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewService } from './review.service';

@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}
  @Auth()
  @Post()
  create(
    @Body() createReviewDto: CreateReviewDto,
    @AuthUser() user: userEntity,
  ) {
    return this.reviewService.create(createReviewDto, user);
  }

  @Auth()
  @Get()
  findAll(@AuthUser() user:userEntity) {
    return this.reviewService.findAll(user);
  }

  @Auth()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reviewService.findOne(id);
  }

  @Auth()
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateReviewDto: UpdateReviewDto,
    @AuthUser() user: userEntity,
  ) {
    return this.reviewService.update(id, updateReviewDto, user);
  }

  @Auth()
  @Delete(':id')
  remove(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.reviewService.remove(id, user);
  }
}
