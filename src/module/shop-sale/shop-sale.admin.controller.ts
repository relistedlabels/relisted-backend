import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { ShopSaleService } from './shop-sale.service';
import { ProductService } from '../product/product.service';
import { CreateShopSaleDto } from './dto/create-shop-sale.dto';
import { UpdateShopSaleDto } from './dto/update-shop-sale.dto';
import { SetShopSaleProductsDto } from './dto/set-shop-sale-products.dto';

@ApiTags('Admin - Sales')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/shop-sales')
export class ShopSaleAdminController {
  constructor(
    private readonly shopSales: ShopSaleService,
    private readonly productService: ProductService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List sales campaigns' })
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.shopSales.listForAdmin(
      page ? parseInt(page, 10) || 1 : 1,
      limit ? parseInt(limit, 10) || 20 : 20,
    );
  }

  @Get('picker/filter-options')
  @ApiOperation({ summary: 'Distinct filter values for the sale product picker' })
  pickerFilterOptions() {
    return this.productService.getAdminPickerFilterOptions();
  }

  @Get('picker/products')
  @ApiOperation({ summary: 'Search listings to add to a sale' })
  searchProducts(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('saleId') saleId?: string,
    @Query('category') category?: string | string[],
    @Query('brand') brand?: string | string[],
    @Query('tags') tags?: string,
    @Query('listingType') listingType?: string | string[],
    @Query('lister') lister?: string | string[],
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('condition') condition?: string,
    @Query('material') material?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('inCloset') inCloset?: string,
  ) {
    return this.shopSales.searchProductsForPicker({
      search,
      page: page ? parseInt(page, 10) || 1 : 1,
      limit: limit ? parseInt(limit, 10) || 20 : 20,
      saleId,
      category,
      brand,
      tags,
      listingType,
      curatorId: lister,
      color,
      size,
      condition,
      material,
      minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      inCloset:
        inCloset === 'true' ? true : inCloset === 'false' ? false : undefined,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a sale campaign' })
  create(@Body() dto: CreateShopSaleDto) {
    return this.shopSales.create(dto);
  }

  @Get(':saleId')
  @ApiOperation({ summary: 'Get sale details with selected listings' })
  get(@Param('saleId') saleId: string) {
    return this.shopSales.getForAdmin(saleId);
  }

  @Patch(':saleId')
  @ApiOperation({ summary: 'Update sale settings' })
  update(@Param('saleId') saleId: string, @Body() dto: UpdateShopSaleDto) {
    return this.shopSales.update(saleId, dto);
  }

  @Patch(':saleId/enabled')
  @ApiOperation({ summary: 'Turn a sale on or off' })
  setEnabled(
    @Param('saleId') saleId: string,
    @Body() body: { isEnabled: boolean },
  ) {
    return this.shopSales.setEnabled(saleId, Boolean(body.isEnabled));
  }

  @Put(':saleId/products')
  @ApiOperation({ summary: 'Replace all listings in a sale' })
  setProducts(
    @Param('saleId') saleId: string,
    @Body() dto: SetShopSaleProductsDto,
  ) {
    return this.shopSales.setProducts(saleId, dto.productIds);
  }

  @Get(':saleId/waitlist')
  @ApiOperation({ summary: 'List waitlist signups for a sale' })
  waitlist(
    @Param('saleId') saleId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.shopSales.listWaitlistForAdmin(
      saleId,
      page ? parseInt(page, 10) || 1 : 1,
      limit ? parseInt(limit, 10) || 20 : 20,
    );
  }

  @Post(':saleId/notify-waitlist')
  @ApiOperation({ summary: 'Email everyone on the sale waitlist' })
  notifyWaitlist(@Param('saleId') saleId: string) {
    return this.shopSales.notifyWaitlistForAdmin(saleId);
  }
}
