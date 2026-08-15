import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { ShopSettingsService } from './shop-settings.service';

@ApiTags('Admin - Shop settings')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/shop-settings')
export class ShopSettingsAdminController {
  constructor(private readonly shopSettings: ShopSettingsService) {}

  @Get('prioritized-brands')
  @ApiOperation({
    summary: 'Get brands prioritized on the main shop route',
  })
  async getPrioritizedBrands() {
    return this.shopSettings.getPrioritizedBrands();
  }

  @Put('prioritized-brands')
  @ApiOperation({
    summary: 'Set brands prioritized on the main shop route',
    description:
      'brandIds order sets priority (first = highest). Selected brands appear first on /shop, then sorted by creation time within each brand.',
  })
  async putPrioritizedBrands(@Body() body: { brandIds?: string[] }) {
    if (!body || !Array.isArray(body.brandIds)) {
      throw new BadRequestException('brandIds must be an array');
    }
    return this.shopSettings.setPrioritizedBrands(body.brandIds);
  }
}
