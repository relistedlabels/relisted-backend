import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductService } from './product.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { ListProductQuery } from './dto/create-product.dto';

@ApiTags('Public - Products')
@Controller('api/public/products')
export class ProductPublicController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'List all products (Public)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['newest', 'oldest', 'price_low', 'price_high', 'popular', 'rating'],
  })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'minPrice', required: false })
  @ApiQuery({ name: 'maxPrice', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({
    name: 'color',
    required: false,
    description: 'Comma-separated colors',
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Comma-separated sizes (measurement)',
  })
  @ApiQuery({
    name: 'condition',
    required: false,
    description: 'Comma-separated conditions',
  })
  @ApiQuery({
    name: 'material',
    required: false,
    description: 'Comma-separated materials',
  })
  @ApiQuery({
    name: 'closetId',
    required: false,
    description: 'Filter products to a single public closet (UUID)',
  })
  @ApiQuery({
    name: 'onlyWithCloset',
    required: false,
    description:
      'If true and closetId is omitted, only products in any closet (closet drops). If both are omitted, only products not in a closet (main shop).',
  })
  @ApiResponse({
    status: 200,
    description: 'Products retrieved successfully',
  })
  async list(@Query() query: any) {
    // Map public query params to internal ListProductQuery
    const listQuery: ListProductQuery = {
      page: query.page,
      count: query.limit,
      search: query.search,
      sort: query.sort,
      category: query.category,
      brand: query.brand,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      color: query.color,
      size: query.size,
      condition: query.condition,
      material: query.material,
      tags: query.tags,
      closetId: query.closetId,
      onlyWithCloset:
        query.onlyWithCloset === true || query.onlyWithCloset === 'true',
      excludeStagingCurator: true,
    };
    return this.productService.list(listQuery);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product details (Public)' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({
    status: 200,
    description: 'Product details retrieved successfully',
  })
  async findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Get product availability (Public)' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiResponse({
    status: 200,
    description: 'Product availability retrieved successfully',
  })
  async getAvailability(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.productService.getProductAvailability(id, startDate, endDate);
  }
}
