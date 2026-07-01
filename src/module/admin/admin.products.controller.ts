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
  ) {
    const pageSize = limit
      ? parseInt(limit, 10)
      : count
        ? parseInt(count, 10)
        : 10;
    return this.adminService.getProductsByStatus(
      'PENDING',
      page ? parseInt(page, 10) : 1,
      pageSize,
      search,
    );
  }

  @Get('rejected')
  @ApiOperation({ summary: 'Get rejected products' })
  async getRejectedProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
  ) {
    const pageSize = limit
      ? parseInt(limit, 10)
      : count
        ? parseInt(count, 10)
        : 10;
    return this.adminService.getProductsByStatus(
      'REJECTED',
      page ? parseInt(page, 10) : 1,
      pageSize,
      search,
    );
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active products' })
  async getActiveProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
  ) {
    const pageSize = limit
      ? parseInt(limit, 10)
      : count
        ? parseInt(count, 10)
        : 10;
    return this.adminService.getProductsByStatus(
      'ACTIVE',
      page ? parseInt(page, 10) : 1,
      pageSize,
      search,
    );
  }

  @Get('rented')
  @ApiOperation({ summary: 'Get rented-out products' })
  async getRentedProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('count') count?: string,
    @Query('search') search?: string,
  ) {
    const pageSize = limit
      ? parseInt(limit, 10)
      : count
        ? parseInt(count, 10)
        : 10;
    return this.adminService.getProductsByStatus(
      'RENTED',
      page ? parseInt(page, 10) : 1,
      pageSize,
      search,
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
}
