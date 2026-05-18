import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { redisConnectionOptions } from 'src/utils/redis-connection';
import {
  buildShipbubbleAddressFingerprint,
  type ShipbubbleAddressFingerprint,
} from './shipbubble-address-normalize';
import type { ShipbubbleAddressContact } from './shipbubble-address-normalize';
import type { ShipbubbleValidatedAddress } from './shipbubble.service';

const REDIS_KEY_PREFIX = 'shipbubble:addr:';

type CachedEntry = {
  addressCode: number;
  formattedAddress: string;
  latitude?: number;
  longitude?: number;
};

@Injectable()
export class ShipbubbleAddressCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ShipbubbleAddressCacheService.name);
  private readonly redisTtlMs: number;
  private redis: Redis | null = null;
  private redisInitAttempted = false;

  constructor(private readonly prisma: PrismaService) {
    this.redisTtlMs = Math.max(
      0,
      Number(process.env.SHIPBUBBLE_ADDRESS_REDIS_CACHE_TTL_MS ?? 86_400_000),
    );
  }

  onModuleDestroy() {
    void this.redis?.quit();
  }

  fingerprint(contact: ShipbubbleAddressContact): ShipbubbleAddressFingerprint {
    return buildShipbubbleAddressFingerprint(contact);
  }

  async lookup(
    contact: ShipbubbleAddressContact,
  ): Promise<ShipbubbleValidatedAddress | null> {
    const fp = this.fingerprint(contact);
    if (!fp.normalizedAddressLine) {
      return null;
    }

    const redisHit = await this.readRedis(fp.addressHash);
    if (redisHit) {
      return this.toValidated(redisHit);
    }

    const dbHit = await this.readDb(fp.addressHash);
    if (dbHit) {
      await this.writeRedis(fp.addressHash, dbHit);
      return this.toValidated(dbHit);
    }

    return null;
  }

  async save(
    contact: ShipbubbleAddressContact,
    validated: ShipbubbleValidatedAddress,
    profileId?: string | null,
  ): Promise<void> {
    const fp = this.fingerprint(contact);
    if (!fp.normalizedAddressLine) {
      return;
    }

    const entry: CachedEntry = {
      addressCode: validated.addressCode,
      formattedAddress: validated.formattedAddress,
      latitude: validated.latitude,
      longitude: validated.longitude,
    };

    await this.writeRedis(fp.addressHash, entry);

    const profileLink =
      profileId != null && String(profileId).trim()
        ? String(profileId).trim()
        : null;

    await this.prisma.shipbubbleAddressVerification.upsert({
      where: { addressHash: fp.addressHash },
      create: {
        addressHash: fp.addressHash,
        addressCode: entry.addressCode,
        normalizedName: fp.normalizedName,
        normalizedPhone: fp.normalizedPhone,
        normalizedAddressLine: fp.normalizedAddressLine,
        formattedAddress: entry.formattedAddress,
        latitude: entry.latitude ?? null,
        longitude: entry.longitude ?? null,
        profileId: profileLink,
        verifiedAt: new Date(),
      },
      update: {
        addressCode: entry.addressCode,
        normalizedName: fp.normalizedName,
        normalizedPhone: fp.normalizedPhone,
        normalizedAddressLine: fp.normalizedAddressLine,
        formattedAddress: entry.formattedAddress,
        latitude: entry.latitude ?? null,
        longitude: entry.longitude ?? null,
        verifiedAt: new Date(),
        ...(profileLink ? { profileId: profileLink } : {}),
      },
    });
  }

  /** Drop cached address_code for one normalized contact (e.g. after Shipbubble rejects a stale code). */
  async invalidate(contact: ShipbubbleAddressContact): Promise<void> {
    const fp = this.fingerprint(contact);
    if (!fp.normalizedAddressLine) return;

    await this.prisma.shipbubbleAddressVerification.deleteMany({
      where: { addressHash: fp.addressHash },
    });
    await this.deleteRedis(fp.addressHash);
  }

  /** Clear cached verifications when a profile address or contact fields change. */
  async invalidateForProfile(profileId: string): Promise<void> {
    const id = String(profileId ?? '').trim();
    if (!id) return;

    const rows = await this.prisma.shipbubbleAddressVerification.findMany({
      where: { profileId: id },
      select: { addressHash: true },
    });

    if (!rows.length) {
      return;
    }

    await this.prisma.shipbubbleAddressVerification.deleteMany({
      where: { profileId: id },
    });

    for (const row of rows) {
      await this.deleteRedis(row.addressHash);
    }

    this.logger.debug(
      `Invalidated ${rows.length} Shipbubble address cache row(s) for profile ${id}`,
    );
  }

  private toValidated(entry: CachedEntry): ShipbubbleValidatedAddress {
    return {
      addressCode: entry.addressCode,
      formattedAddress: entry.formattedAddress,
      latitude: entry.latitude,
      longitude: entry.longitude,
      raw: { cached: true },
    };
  }

  private redisKey(hash: string): string {
    return `${REDIS_KEY_PREFIX}${hash}`;
  }

  private getRedis(): Redis | null {
    if (this.redisInitAttempted) {
      return this.redis;
    }
    this.redisInitAttempted = true;

    if (this.redisTtlMs <= 0) {
      return null;
    }

    if (process.env.SHIPBUBBLE_ADDRESS_REDIS_CACHE === '0') {
      return null;
    }

    try {
      const opts = redisConnectionOptions();
      this.redis =
        typeof opts === 'string' ? new Redis(opts) : new Redis(opts);
      this.redis.on('error', (err) => {
        this.logger.warn(`Shipbubble address Redis error: ${err.message}`);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Shipbubble address Redis unavailable: ${msg}`);
      this.redis = null;
    }

    return this.redis;
  }

  private async readRedis(hash: string): Promise<CachedEntry | null> {
    const client = this.getRedis();
    if (!client || this.redisTtlMs <= 0) return null;

    try {
      const raw = await client.get(this.redisKey(hash));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedEntry;
      if (
        !Number.isFinite(parsed.addressCode) ||
        !String(parsed.formattedAddress ?? '').trim()
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeRedis(hash: string, entry: CachedEntry): Promise<void> {
    const client = this.getRedis();
    if (!client || this.redisTtlMs <= 0) return;

    try {
      await client.set(
        this.redisKey(hash),
        JSON.stringify(entry),
        'PX',
        this.redisTtlMs,
      );
    } catch {
      // Redis is optional; DB remains the source of truth.
    }
  }

  private async deleteRedis(hash: string): Promise<void> {
    const client = this.getRedis();
    if (!client) return;
    try {
      await client.del(this.redisKey(hash));
    } catch {
      // ignore
    }
  }

  private async readDb(hash: string): Promise<CachedEntry | null> {
    const row = await this.prisma.shipbubbleAddressVerification.findUnique({
      where: { addressHash: hash },
    });
    if (!row) return null;

    return {
      addressCode: row.addressCode,
      formattedAddress: row.formattedAddress,
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
    };
  }
}
