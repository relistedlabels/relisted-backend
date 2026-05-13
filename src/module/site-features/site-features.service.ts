import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { PLATFORM_SETTING_HEADER_CLOSETS_SHOP_NAV } from './site-features.constants';

@Injectable()
export class SiteFeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Default true so existing deployments keep the link until an admin turns it off. */
  getHeaderClosetsShopNavEnabledFromValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'object' && value !== null && 'enabled' in value) {
      return Boolean((value as { enabled: unknown }).enabled);
    }
    return true;
  }

  async getHeaderClosetsShopNavEnabled(): Promise<boolean> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: PLATFORM_SETTING_HEADER_CLOSETS_SHOP_NAV },
    });
    return this.getHeaderClosetsShopNavEnabledFromValue(row?.value);
  }

  async setHeaderClosetsShopNavEnabled(enabled: boolean) {
    await this.prisma.platformSetting.upsert({
      where: { key: PLATFORM_SETTING_HEADER_CLOSETS_SHOP_NAV },
      create: {
        key: PLATFORM_SETTING_HEADER_CLOSETS_SHOP_NAV,
        value: enabled,
      },
      update: { value: enabled },
    });
    return {
      success: true as const,
      data: { headerClosetsShopNavEnabled: enabled },
    };
  }
}
