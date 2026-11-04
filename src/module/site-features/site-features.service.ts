import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import {
  PLATFORM_SETTING_HEADER_CLOSETS_SHOP_NAV,
  PLATFORM_SETTING_OPERATIONS_PAUSE,
} from './site-features.constants';
import {
  DEFAULT_OPERATIONS_PAUSE_CLOSED_FROM,
  DEFAULT_OPERATIONS_PAUSE_RESUME_LABEL,
  type OperationsPauseConfig,
} from './operations-pause.types';

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

  operationsPauseClosedFromFromRaw(raw: unknown): string {
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    return DEFAULT_OPERATIONS_PAUSE_CLOSED_FROM;
  }

  operationsPauseFromSettingValue(value: unknown): OperationsPauseConfig {
    const inactive: OperationsPauseConfig = {
      active: false,
      resumeLabel: DEFAULT_OPERATIONS_PAUSE_RESUME_LABEL,
      closedFromLabel: DEFAULT_OPERATIONS_PAUSE_CLOSED_FROM,
    };
    if (value === null || value === undefined) return inactive;
    if (typeof value === 'boolean') {
      return value
        ? {
            active: true,
            resumeLabel: DEFAULT_OPERATIONS_PAUSE_RESUME_LABEL,
            closedFromLabel: DEFAULT_OPERATIONS_PAUSE_CLOSED_FROM,
          }
        : inactive;
    }
    if (typeof value === 'object' && value !== null) {
      const o = value as Record<string, unknown>;
      const active = Boolean(o.active ?? o.enabled);
      const resumeRaw = o.resumeLabel ?? o.resumeAtLabel ?? o.resume;
      const resumeLabel =
        typeof resumeRaw === 'string' && resumeRaw.trim()
          ? resumeRaw.trim()
          : DEFAULT_OPERATIONS_PAUSE_RESUME_LABEL;
      const closedFromLabel = this.operationsPauseClosedFromFromRaw(
        o.closedFromLabel ?? o.closedFrom,
      );
      return { active, resumeLabel, closedFromLabel };
    }
    return inactive;
  }

  operationsPauseFromEnv(): OperationsPauseConfig | null {
    const flag = process.env.OPERATIONS_PAUSE?.trim().toLowerCase();
    if (flag !== 'true' && flag !== '1' && flag !== 'yes') return null;
    const label = process.env.OPERATIONS_PAUSE_RESUME_LABEL?.trim();
    const closedFrom = process.env.OPERATIONS_PAUSE_CLOSED_FROM?.trim();
    return {
      active: true,
      resumeLabel: label || DEFAULT_OPERATIONS_PAUSE_RESUME_LABEL,
      closedFromLabel: closedFrom || DEFAULT_OPERATIONS_PAUSE_CLOSED_FROM,
    };
  }

  async getOperationsPause(): Promise<OperationsPauseConfig> {
    const fromEnv = this.operationsPauseFromEnv();
    if (fromEnv) return fromEnv;

    const row = await this.prisma.platformSetting.findUnique({
      where: { key: PLATFORM_SETTING_OPERATIONS_PAUSE },
    });
    return this.operationsPauseFromSettingValue(row?.value);
  }
}
