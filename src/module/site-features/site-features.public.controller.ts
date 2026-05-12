import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SiteFeaturesService } from './site-features.service';

@ApiTags('Public - Site features')
@Controller('api/public/site-features')
export class SiteFeaturesPublicController {
  constructor(private readonly siteFeatures: SiteFeaturesService) {}

  @Get()
  @ApiOperation({ summary: 'Public site feature flags (no auth)' })
  async getPublicSiteFeatures() {
    const headerClosetsShopNavEnabled =
      await this.siteFeatures.getHeaderClosetsShopNavEnabled();
    return {
      success: true as const,
      data: { headerClosetsShopNavEnabled },
    };
  }
}
