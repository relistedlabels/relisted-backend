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
import { SiteFeaturesService } from './site-features.service';

@ApiTags('Admin - Site features')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/site-features')
export class SiteFeaturesAdminController {
  constructor(private readonly siteFeatures: SiteFeaturesService) {}

  @Get()
  @ApiOperation({ summary: 'Site feature flags (admin)' })
  async getSiteFeatures() {
    const headerClosetsShopNavEnabled =
      await this.siteFeatures.getHeaderClosetsShopNavEnabled();
    return {
      success: true as const,
      data: { headerClosetsShopNavEnabled },
    };
  }

  @Put()
  @ApiOperation({
    summary: 'Update site feature flags',
    description:
      'headerClosetsShopNavEnabled toggles the Closets link beside How it works on the public header.',
  })
  async putSiteFeatures(
    @Body()
    body: {
      headerClosetsShopNavEnabled?: boolean;
    },
  ) {
    if (typeof body?.headerClosetsShopNavEnabled !== 'boolean') {
      throw new BadRequestException(
        'headerClosetsShopNavEnabled must be a boolean',
      );
    }
    return this.siteFeatures.setHeaderClosetsShopNavEnabled(
      body.headerClosetsShopNavEnabled,
    );
  }
}
