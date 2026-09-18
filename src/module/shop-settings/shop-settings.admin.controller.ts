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

  @Get('visible-brands')
  @ApiOperation({
    summary: 'Get site-visible brands and full brand allowlist settings',
  })
  async getVisibleBrands() {
    return this.shopSettings.getVisibleBrands();
  }

  @Put('visible-brands')
  @ApiOperation({
    summary: 'Set which brands are visible on the site',
    description:
      'Removing a brand deactivates its listings (rented listings are skipped). Re-adding a brand reactivates listings that were deactivated for brand removal.',
  })
  async putVisibleBrands(@Body() body: { brandIds?: string[] }) {
    if (!body || !Array.isArray(body.brandIds)) {
      throw new BadRequestException('brandIds must be an array');
    }
    return this.shopSettings.setVisibleBrands(body.brandIds);
  }
}
