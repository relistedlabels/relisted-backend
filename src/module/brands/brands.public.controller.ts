import { Controller, Get } from '@nestjs/common';
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
}
