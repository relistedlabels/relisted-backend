import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ShopSaleService } from './shop-sale.service';
import { RegisterShopSaleInterestDto } from './dto/register-shop-sale-interest.dto';

@ApiTags('Public - Shop sales')
@Controller('api/public/shop-sales')
export class ShopSalePublicController {
  constructor(private readonly shopSales: ShopSaleService) {}

  @Get('active')
  @ApiOperation({
    summary: 'Active sales for header navigation (enabled, upcoming or live)',
  })
  async listActive() {
    const sales = await this.shopSales.listActiveSalesForNav();
    return { success: true as const, data: sales };
  }

  @Get('featured')
  @ApiOperation({
    summary: 'Featured sale for the home banner (enabled, not ended)',
  })
  async getFeatured() {
    const sale = await this.shopSales.getFeaturedSale();
    return { success: true as const, data: sale };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Public sale details by slug' })
  getBySlug(@Param('slug') slug: string) {
    return this.shopSales.getPublicBySlug(slug);
  }

  @Post(':slug/interest')
  @ApiOperation({ summary: 'Join the notify list for a sale' })
  @ApiResponse({ status: 201, description: 'Interest recorded' })
  @ApiBadRequestResponse({ description: 'Invalid email or waitlist closed' })
  register(
    @Param('slug') slug: string,
    @Body() dto: RegisterShopSaleInterestDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.shopSales.registerInterest(slug, dto, authorization);
  }
}
