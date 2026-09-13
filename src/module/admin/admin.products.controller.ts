import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Body,
  Query,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';
import type { ProductListFilterInput } from '../product/product-list-filters.util';

function parsePageSize(
  page?: string,
  limit?: string,
  count?: string,
): { page: number; pageSize: number } {
  const pageSize = limit
    ? parseInt(limit, 10)
    : count
      ? parseInt(count, 10)
      : 10;
  return {
    page: page ? parseInt(page, 10) : 1,
    pageSize,
  };
}

function parseProductListFilters(query: {
  brand?: string | string[];
  category?: string | string[];
  tags?: string;
  listingType?: string | string[];
  lister?: string | string[];
  color?: string;
  size?: string;
  condition?: string;
  material?: string;
  minPrice?: string;
  maxPrice?: string;
}): ProductListFilterInput {
  return {
    brand: query.brand,
    category: query.category,
    tags: query.tags,
    listingType: query.listingType,
    curatorId: query.lister,
    color: query.color,
    size: query.size,
    condition: query.condition,
    material: query.material,
    minPrice: query.minPrice ? parseInt(query.minPrice, 10) : undefined,
    maxPrice: query.maxPrice ? parseInt(query.maxPrice, 10) : undefined,
  };
}

@ApiTags('Admin Products')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/products')
export class AdminProductsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('statistics')
  @ApiOperation({ summary: 'Get product statistics' })
  async getProductStats() {
    return this.adminService.getProductStats();
  }

  @Get('pending')
  @ApiOperation({ summary: 'Get pending products' })
  async getPendingProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
    @Query('brand') brand?: string | string[],
    @Query('category') category?: string | string[],
    @Query('tags') tags?: string,
    @Query('listingType') listingType?: string | string[],
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('lister') lister?: string | string[],
    @Query('condition') condition?: string,
    @Query('material') material?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    const { page: pageNum, pageSize } = parsePageSize(page, limit, count);
    return this.adminService.getProductsByStatus(
      'PENDING',
      pageNum,
      pageSize,
      search,
      parseProductListFilters({
        brand,
        category,
        tags,
        listingType,
        color,
        size,
        lister,
        condition,
        material,
        minPrice,
        maxPrice,
      }),
    );
  }

  @Get('rejected')
  @ApiOperation({ summary: 'Get rejected products' })
  async getRejectedProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
    @Query('brand') brand?: string | string[],
    @Query('category') category?: string | string[],
    @Query('tags') tags?: string,
    @Query('listingType') listingType?: string | string[],
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('lister') lister?: string | string[],
    @Query('condition') condition?: string,
    @Query('material') material?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    const { page: pageNum, pageSize } = parsePageSize(page, limit, count);
    return this.adminService.getProductsByStatus(
      'REJECTED',
      pageNum,
      pageSize,
      search,
      parseProductListFilters({
        brand,
        category,
        tags,
        listingType,
        color,
        size,
        lister,
        condition,
        material,
        minPrice,
        maxPrice,
      }),
    );
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active products' })
  async getActiveProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
    @Query('brand') brand?: string | string[],
    @Query('category') category?: string | string[],
    @Query('tags') tags?: string,
    @Query('listingType') listingType?: string | string[],
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('lister') lister?: string | string[],
    @Query('condition') condition?: string,
    @Query('material') material?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    const { page: pageNum, pageSize } = parsePageSize(page, limit, count);
    return this.adminService.getProductsByStatus(
      'ACTIVE',
      pageNum,
      pageSize,
      search,
      parseProductListFilters({
        brand,
        category,
        tags,
        listingType,
        color,
        size,
        lister,
        condition,
        material,
        minPrice,
        maxPrice,
      }),
    );
  }

  @Get('inactive')
  @ApiOperation({ summary: 'Get deactivated (unavailable) products' })
  async getInactiveProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
    @Query('brand') brand?: string | string[],
    @Query('category') category?: string | string[],
    @Query('tags') tags?: string,
    @Query('listingType') listingType?: string | string[],
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('lister') lister?: string | string[],
    @Query('condition') condition?: string,
    @Query('material') material?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    const { page: pageNum, pageSize } = parsePageSize(page, limit, count);
    return this.adminService.getProductsByStatus(
      'UNAVAILABLE',
      pageNum,
      pageSize,
      search,
      parseProductListFilters({
        brand,
        category,
        tags,
        listingType,
        color,
        size,
        lister,
        condition,
        material,
        minPrice,
        maxPrice,
      }),
    );
  }

  @Get('rented')
  @ApiOperation({ summary: 'Get rented-out products' })
  async getRentedProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
    @Query('brand') brand?: string | string[],
    @Query('category') category?: string | string[],
    @Query('tags') tags?: string,
    @Query('listingType') listingType?: string | string[],
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('lister') lister?: string | string[],
    @Query('condition') condition?: string,
    @Query('material') material?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    const { page: pageNum, pageSize } = parsePageSize(page, limit, count);
    return this.adminService.getProductsByStatus(
      'RENTED',
      pageNum,
      pageSize,
      search,
      parseProductListFilters({
        brand,
        category,
        tags,
        listingType,
        color,
        size,
        lister,
        condition,
        material,
        minPrice,
        maxPrice,
      }),
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get product categories' })
  async getProductCategories() {
    return this.adminService.getProductCategories();
  }

  @Get('brands')
  @ApiOperation({ summary: 'Get product brands' })
  async getProductBrands() {
    return this.adminService.getProductBrands();
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Get product details' })
  async getProductDetails(@Param('productId') productId: string) {
    return this.adminService.getProductDetails(productId);
  }

  @Patch(':productId/approve')
  @ApiOperation({ summary: 'Approve a product' })
  async approveProduct(@Param('productId') productId: string) {
    return this.adminService.updateProductStatus(productId, 'APPROVED');
  }

  @Patch(':productId/reject')
  @ApiOperation({ summary: 'Reject a product' })
  async rejectProduct(
    @Param('productId') productId: string,
    @Body() data: { rejectionComment: string },
  ) {
    return this.adminService.updateProductStatus(
      productId,
      'REJECTED',
      data.rejectionComment,
    );
  }

  @Patch(':productId/pending')
  @ApiOperation({ summary: 'Revert an approved product to pending' })
  async revertProductToPending(@Param('productId') productId: string) {
    return this.adminService.revertProductToPending(productId);
  }

  @Get('listings/:productId/availability')
  @ApiOperation({ summary: 'Get product rental availability & calendar' })
  async getProductAvailability(
    @Param('productId') productId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.adminService.getProductAvailability(
      productId,
      parseInt(month, 10),
      parseInt(year, 10),
    );
  }

  @Get('listings/:productId/activity')
  @ApiOperation({ summary: 'Get product activity history' })
  async getProductActivity(@Param('productId') productId: string) {
    return this.adminService.getProductActivity(productId);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Delete a product' })
  async deleteProduct(@Param('productId') productId: string) {
    return this.adminService.deleteProduct(productId);
  }

  @Post('bulk/deactivate')
  @ApiOperation({ summary: 'Bulk deactivate products' })
  async bulkDeactivateProducts(@Body() data: { productIds: string[] }) {
    return this.adminService.bulkUpdateProductAvailability(
      data.productIds,
      false,
    );
  }

  @Post('bulk/reactivate')
  @ApiOperation({ summary: 'Bulk reactivate products' })
  async bulkReactivateProducts(@Body() data: { productIds: string[] }) {
    return this.adminService.bulkUpdateProductAvailability(
      data.productIds,
      true,
    );
  }
}
