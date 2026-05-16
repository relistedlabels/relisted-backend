import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type GeocodePoint = { lat: number; lng: number };

export type GeocodeResult = GeocodePoint & {
  /** How specific the match was (for logs). */
  precision: 'full' | 'city' | 'state';
  matchedQuery: string;
};

/**
 * Forward geocoding via OpenStreetMap Nominatim (free, no API key).
 * Policy: https://operations.osmfoundation.org/policies/nominatim/
 * Set NOMINATIM_USER_AGENT to a stable app plus contact (required by Nominatim).
 *
 * Nigerian estate / landmark names are often missing from OSM; we fall back to
 * city + state when the full line returns no hits.
 */
@Injectable()
export class NominatimGeocodeService {
  private readonly logger = new Logger(NominatimGeocodeService.name);
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private mutex: Promise<void> = Promise.resolve();
  private lastRequestEndAt = 0;
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: GeocodeResult | null }
  >();
  private readonly cacheTtlMs: number;

  constructor() {
    this.baseUrl = (
      process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org'
    ).replace(/\/$/, '');
    this.userAgent =
      process.env.NOMINATIM_USER_AGENT?.trim() ||
      'RelistedBackend/1.0 (https://relisted.com)';
    this.timeoutMs = Math.max(
      2000,
      Number(process.env.NOMINATIM_HTTP_TIMEOUT_MS ?? 12_000),
    );
    this.minIntervalMs = Math.max(
      1100,
      Number(process.env.NOMINATIM_MIN_INTERVAL_MS ?? 1100),
    );
    this.cacheTtlMs = Math.max(
      0,
      Number(process.env.NOMINATIM_CACHE_TTL_MS ?? 86_400_000),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private withNigeriaSuffix(line: string): string {
    const t = String(line ?? '').trim();
    if (!t) return '';
    if (t.toLowerCase().includes('nigeria')) return t;
    return `${t}, Nigeria`;
  }

  /**
   * Parses "street, city, state" (common Relisted snapshot shape).
   */
  parseCommaAddressLine(line: string): {
    street?: string;
    city?: string;
    state?: string;
  } {
    const stripped = String(line ?? '')
      .replace(/,?\s*nigeria\s*$/i, '')
      .trim();
    const parts = stripped
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return {};
    if (parts.length === 1) return { street: parts[0] };
    if (parts.length === 2) {
      return { street: parts[0], city: parts[1] };
    }
    const state = parts[parts.length - 1];
    const city = parts[parts.length - 2];
    const street = parts.slice(0, -2).join(', ');
    return { street, city, state };
  }

  /** Ordered from most specific to coarsest (city/state are usually in OSM for NG). */
  buildQueryCandidates(addressLine: string): Array<{
    q: string;
    precision: GeocodeResult['precision'];
  }> {
    const line = String(addressLine ?? '').trim();
    if (!line) return [];

    const seen = new Set<string>();
    const out: Array<{ q: string; precision: GeocodeResult['precision'] }> = [];
    const push = (q: string, precision: GeocodeResult['precision']) => {
      const key = q.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ q: this.withNigeriaSuffix(q.replace(/,?\s*nigeria\s*$/i, '').trim()), precision });
    };

    push(line, 'full');

    const { street, city, state } = this.parseCommaAddressLine(line);
    if (street && city && state) {
      push(`${street}, ${city}, ${state}`, 'full');
    }
    if (city && state) {
      push(`${city}, ${state}`, 'city');
    } else if (city) {
      push(city, 'city');
    }
    if (state && state.toLowerCase() !== 'nigeria') {
      push(state, 'state');
    }

    return out;
  }

  private async doSearch(q: string): Promise<GeocodePoint | null> {
    try {
      const res = await axios.get(`${this.baseUrl}/search`, {
        params: {
          q,
          format: 'json',
          limit: 1,
          countrycodes: 'ng',
        },
        timeout: this.timeoutMs,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        validateStatus: () => true,
      });
      if (res.status !== 200 || !Array.isArray(res.data) || !res.data[0]) {
        return null;
      }
      const row = res.data[0];
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch (e: any) {
      this.logger.warn(`Nominatim geocode failed for "${q}": ${e?.message ?? e}`);
      return null;
    }
  }

  private async runWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const now = Date.now();
      const wait = Math.max(0, this.lastRequestEndAt + this.minIntervalMs - now);
      if (wait > 0) await this.sleep(wait);
      return await fn();
    } finally {
      this.lastRequestEndAt = Date.now();
      release();
    }
  }

  /**
   * Returns coordinates, trying full address then city/state fallbacks.
   */
  async geocodeAddressLine(addressLine: string): Promise<GeocodeResult | null> {
    const line = String(addressLine ?? '').trim();
    if (!line) return null;

    const cacheKey = line.toLowerCase();
    if (this.cacheTtlMs > 0) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) return hit.value;
    }

    const candidates = this.buildQueryCandidates(line);
    if (!candidates.length) return null;

    const result = await this.runWithRateLimit(async () => {
      for (const { q, precision } of candidates) {
        const pt = await this.doSearch(q);
        if (pt) {
          if (precision !== 'full') {
            this.logger.warn(
              `Nominatim: approximate ${precision}-level match for "${line}" via "${q}"`,
            );
          }
          return {
            ...pt,
            precision,
            matchedQuery: q,
          };
        }
        this.logger.debug(`Nominatim: no result for "${q}"`);
      }
      this.logger.warn(`Nominatim: no result for address line "${line}"`);
      return null;
    });

    if (this.cacheTtlMs > 0) {
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        value: result,
      });
    }
    return result;
  }
}
