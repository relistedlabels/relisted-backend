import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ClosetService } from './closet.service';
import { ProductService } from '../product/product.service';
import { ListProductQuery } from '../product/dto/create-product.dto';

@ApiTags('Public - Closets')
@Controller('api/public/closets')
export class ClosetPublicController {
  constructor(
    private readonly closetService: ClosetService,
    private readonly productService: ProductService,
  ) {}

  /** Base list route must be registered before `:slug` / `:slug/products`. */
  @Get()
  @ApiOperation({
    summary: 'List active public closets with visible inventory (marketing)',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Max closets (1–50)' })
  @ApiResponse({ status: 200 })
  async listPublic(@Query('limit') limit?: string) {
    const parsed = parseInt(limit ?? '12', 10);
    const n = Number.isFinite(parsed) ? parsed : 12;
    return this.closetService.listPublicForMarketing(n);
  }

  /** Declare before `:slug` so paths like `…/closets/foo/products` match correctly. */
  @Get(':slug/products')
  @ApiOperation({
    summary: 'List shop-visible products in an active closet (public)',
  })
  @ApiParam({ name: 'slug', description: 'Closet slug', example: 'amanda-daniels' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'minPrice', required: false })
  @ApiQuery({ name: 'maxPrice', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'color', required: false })
  @ApiQuery({ name: 'size', required: false })
  @ApiQuery({ name: 'condition', required: false })
  @ApiQuery({ name: 'material', required: false })
  @ApiQuery({ name: 'tags', required: false })
  @ApiResponse({ status: 200, description: 'Products for closet' })
  async listProducts(@Param('slug') slug: string, @Query() query: any) {
    const closetRes = await this.closetService.getActivePublicClosetBySlug(slug);
    const closetId = closetRes.data.id;
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
      closetId,
    };
    return this.productService.list(listQuery);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get public closet metadata by slug' })
  @ApiParam({ name: 'slug', description: 'Closet slug' })
  @ApiResponse({ status: 200 })
  async getBySlug(@Param('slug') slug: string) {
    return this.closetService.getActivePublicClosetBySlug(slug);
  }
}
