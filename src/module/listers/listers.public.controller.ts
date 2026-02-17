import { Controller, Get, Param, Query } from '@nestjs/common';
import { ListersService } from './listers.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';

@ApiTags('Public - Listers')
@Controller('api/public/users')
export class ListersPublicController {
  constructor(private readonly listersService: ListersService) {}

  @Get()
  @ApiOperation({ summary: 'List all listers/curators (Public)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'sort', required: false, enum: ['rating', 'newest', 'popularity'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({
    status: 200,
    description: 'Listers retrieved successfully',
  })
  async findAll(@Query() query: any) {
    return this.listersService.getPublicListers(query);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get lister profile (Public)' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Lister profile retrieved successfully',
  })
  async findOne(@Param('userId') userId: string) {
    return this.listersService.getPublicListerProfile(userId);
  }

  @Get(':userId/products')
  @ApiOperation({ summary: 'Get lister products (Public)' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({
    status: 200,
    description: 'Lister products retrieved successfully',
  })
  async getProducts(@Param('userId') userId: string, @Query() query: any) {
    return this.listersService.getListerPublicProducts(userId, query);
  }

  @Get(':userId/reviews')
  @ApiOperation({ summary: 'Get lister reviews (Public)' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sort', required: false })
  @ApiResponse({
    status: 200,
    description: 'Lister reviews retrieved successfully',
  })
  async getReviews(@Param('userId') userId: string, @Query() query: any) {
    return this.listersService.getListerPublicReviews(userId, query);
  }
}
