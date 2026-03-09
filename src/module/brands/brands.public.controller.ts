import { Controller, Get, Param } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Public - Brands')
@Controller('api/public/brands')
export class BrandsPublicController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @ApiOperation({ summary: 'List all brands (Public)' })
  @ApiResponse({
    status: 200,
    description: 'Brands retrieved successfully',
  })
  async findAll() {
    return this.brandsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a brand by ID (Public)' })
  @ApiResponse({
    status: 200,
    description: 'Brand retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Brand not found',
  })
  async findOne(@Param('id') id: string) {
    return this.brandsService.findOne(id);
  }
}
