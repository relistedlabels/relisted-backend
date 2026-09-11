import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { topshipSanitizeDescription } from './topship-description';
import {
  normalizeTopshipBookingDetail,
  normalizeTopshipPickupRatePayload,
  normalizeTopshipShipmentRatePayload,
} from './topship-city';

@Injectable()
export class TopshipService {
  private readonly logger = new Logger(TopshipService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  /** Hard cap per HTTP call so checkout summary cannot hang on a stalled upstream (axios default is no timeout). */
  private readonly httpTimeoutMs: number;
  /** Shorter cap for get-pickup-rates / get-shipment-rate quote GETs (admin + checkout). */
  private readonly quoteHttpTimeoutMs: number;
  /**
   * Reuse TCP/TLS across concurrent quote GETs and repeat checkout summaries.
   * Set TOPSHIP_QUOTE_CACHE_TTL_MS>0 to cache pickup/shipment rate arrays briefly across requests (same payload key).
   */
  private readonly quoteCacheTtlMs: number;
  private readonly quoteCache = new Map<
    string,
    { expiresAt: number; promise: Promise<any[]> }
  >();

  private readonly httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
  });
  private readonly httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
  });

  constructor() {
    this.baseUrl =
      process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
    this.apiKey = process.env.TOPSHIP_API_KEY || '';
    this.httpTimeoutMs = Math.max(
      1000,
      Number(process.env.TOPSHIP_HTTP_TIMEOUT_MS ?? 45_000),
    );
    this.quoteHttpTimeoutMs = Math.max(
      1000,
      Number(
        process.env.TOPSHIP_QUOTE_HTTP_TIMEOUT_MS ??
          process.env.TOPSHIP_HTTP_TIMEOUT_MS ??
          20_000,
      ),
    );
    this.quoteCacheTtlMs = Math.max(
      0,
      Number(process.env.TOPSHIP_QUOTE_CACHE_TTL_MS ?? 0),
    );
  }

  quoteHttpTimeout(): number {
    return this.quoteHttpTimeoutMs;
  }

  private quoteAxiosOpts() {
    return {
      timeout: this.quoteHttpTimeoutMs,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    };
  }

  private wrapQuotedRates(
    kind: 'pickup' | 'ship' | 'ship-linehaul',
    payload: unknown,
    compute: () => Promise<any[]>,
  ): Promise<any[]> {
    if (this.quoteCacheTtlMs <= 0) return compute();

    let key: string;
    try {
      key = `${kind}:${
        typeof payload === 'string' ? payload : JSON.stringify(payload)
      }`;
    } catch {
      key = `${kind}:fallback`;
    }

    const now = Date.now();
    const hit = this.quoteCache.get(key);
    if (hit && hit.expiresAt > now) return hit.promise;

    const promise = compute().catch((err: unknown) => {
      this.quoteCache.delete(key);
      throw err;
    });

    this.quoteCache.set(key, {
      expiresAt: now + this.quoteCacheTtlMs,
      promise,
    });

    if (this.quoteCache.size > 400) {
      for (const [k, v] of this.quoteCache) {
        if (v.expiresAt <= now) this.quoteCache.delete(k);
      }
    }

    return promise;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * save-shipment GraphQL expects PricingTierType enum casing (e.g. Chowdeck),
   * while our checkout / rate helpers use lowercase slugs (chowdeck, glovo).
   */
  private toGraphqlPricingTierType(
    tier: string | null | undefined,
  ): string {
    const t = String(tier ?? '').trim().toLowerCase();
    if (t === 'glovo') return 'Glovo';
    if (t === 'chowdeck') return 'Chowdeck';
    if (!t) return 'Chowdeck';
    const raw = String(tier ?? '').trim();
    if (/^[A-Z][a-zA-Z0-9]*$/.test(raw)) return raw;
    return 'Chowdeck';
  }

  private normalizeSaveShipmentPayload(data: any) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.shipment)) {
      return data;
    }
    return {
      ...data,
      shipment: data.shipment.map((row: any) => ({
        ...row,
        senderDetail: normalizeTopshipBookingDetail(row?.senderDetail),
        receiverDetail: normalizeTopshipBookingDetail(row?.receiverDetail),
        pricingTier: this.toGraphqlPricingTierType(row?.pricingTier),
        pickupPartner: this.toGraphqlPricingTierType(
          row?.pickupPartner ?? row?.pricingTier,
        ),
        items: Array.isArray(row?.items)
          ? row.items.map((it: any) => {
              const sanitized = topshipSanitizeDescription(it?.description);
              return {
                ...it,
                description:
                  sanitized || topshipSanitizeDescription('Relisted items'),
              };
            })
          : row.items,
      })),
    };
  }

  private filterPickupRates(rates: any[]): any[] {
    const allowedPartners = new Set([
      'chowdeck',
      'glovo',
    ]);

    const filtered = (Array.isArray(rates) ? rates : [])
      .filter((r) => {
        const partner = String(r?.partner ?? '')
          .trim()
          .toLowerCase();
        if (!allowedPartners.has(partner)) return false;

        const duration = String(r?.duration ?? '')
          .trim()
          .toLowerCase();
        if (duration && !duration.includes('same-day')) return false;

        return true;
      })
      .sort((a, b) => {
        const aCharge = Number(a?.pickupCharge ?? 0);
        const bCharge = Number(b?.pickupCharge ?? 0);
        return aCharge - bCharge;
      });

    return filtered;
  }

  private filterShipmentRates(rates: any[]): any[] {
    const allowed = new Set(['chowdeck', 'glovo']);
    const list = Array.isArray(rates) ? rates : [];

    const hasPartnerRates = list.some((r) => {
      const tier = String(r?.pricingTier ?? r?.name ?? '')
        .trim()
        .toLowerCase();
      return allowed.has(tier);
    });

    if (!hasPartnerRates) return list;

    return list
      .filter((r) => {
        const tier = String(r?.pricingTier ?? r?.name ?? '')
          .trim()
          .toLowerCase();
        return allowed.has(tier);
      })
      .sort((a, b) => {
        const aCost = Number(a?.cost ?? 0);
        const bCost = Number(b?.cost ?? 0);
        return aCost - bCost;
      });
  }

  private summarizeShipmentRateRequest(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object') {
      return { payload: typeof data };
    }
    const d = data as Record<string, unknown>;
    const sender = d.senderDetails as Record<string, unknown> | undefined;
    const receiver = d.receiverDetails as Record<string, unknown> | undefined;
    return {
      senderCity: sender?.cityName ?? null,
      receiverCity: receiver?.cityName ?? null,
      totalWeight: d.totalWeight ?? null,
    };
  }

  private summarizeShipmentRateRows(rows: any[]): string {
    return rows
      .map((r) => {
        const tier = String(r?.pricingTier ?? r?.name ?? '?').trim();
        const cost = r?.cost != null ? Number(r.cost) : null;
        return cost != null ? `${tier}:${cost}` : tier;
      })
      .join(', ');
  }

  async getShipmentRate(data: any): Promise<any[]> {
    const normalized = normalizeTopshipShipmentRatePayload(data);
    const requestSummary = this.summarizeShipmentRateRequest(normalized);
    this.logger.log(
      `Topship get-shipment-rate request: ${JSON.stringify(requestSummary)}`,
    );
    try {
      const rows = await this.wrapQuotedRates('ship', normalized, async () => {
        const response = await axios.get(`${this.baseUrl}/get-shipment-rate`, {
          headers: this.headers,
          ...this.quoteAxiosOpts(),
          params: {
            shipmentDetail:
              typeof normalized === 'string'
                ? normalized
                : JSON.stringify(normalized),
          },
        });
        const rawList = Array.isArray(response.data) ? response.data : [];
        const filtered = this.filterShipmentRates(response.data);
        this.logger.log(
          `Topship get-shipment-rate response: raw=${rawList.length} filtered=${filtered.length}${filtered.length ? ` [${this.summarizeShipmentRateRows(filtered)}]` : ''}`,
        );
        if (rawList.length > 0 && filtered.length === 0) {
          this.logger.warn(
            `Topship get-shipment-rate returned ${rawList.length} row(s) but none matched chowdeck/glovo after filter`,
          );
        }
        return filtered;
      });
      return rows;
    } catch (error: any) {
      this.logger.warn(
        `Topship get-shipment-rate failed: ${error?.message ?? error}`,
      );
      this.handleError(error, { quote: true });
    }
  }

  async getShopAndShipRates(data: any) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-shopnship-rates`, {
        headers: this.headers,
        timeout: this.httpTimeoutMs,
        params: {
          input: typeof data === 'string' ? data : JSON.stringify(data),
        },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  private summarizePickupRateRequest(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object') {
      return { payload: typeof data };
    }
    const d = data as Record<string, unknown>;
    const sender = d.senderDetail as Record<string, unknown> | undefined;
    return {
      city: sender?.city ?? null,
      state: sender?.state ?? null,
      pickupDate: d.pickupDate ?? null,
    };
  }

  private summarizePickupRateRows(rows: any[]): string {
    return rows
      .map((r) => {
        const partner = String(r?.partner ?? '?').trim();
        const charge = r?.pickupCharge != null ? Number(r.pickupCharge) : null;
        return charge != null ? `${partner}:${charge}` : partner;
      })
      .join(', ');
  }

  /**
   * City-to-city line-haul options (Dellyman, Fez, Budget, etc.).
   * Used with {@link getPickupRates} when quoting Chowdeck/Glovo pickup partners.
   */
  async getLinehaulShipmentRates(data: any): Promise<any[]> {
    const normalized = normalizeTopshipShipmentRatePayload(data);
    const requestSummary = this.summarizeShipmentRateRequest(normalized);
    this.logger.log(
      `Topship get-shipment-rate (linehaul) request: ${JSON.stringify(requestSummary)}`,
    );
    try {
      const rows = await this.wrapQuotedRates(
        'ship-linehaul',
        normalized,
        async () => {
        const response = await axios.get(`${this.baseUrl}/get-shipment-rate`, {
          headers: this.headers,
          ...this.quoteAxiosOpts(),
          params: {
            shipmentDetail:
              typeof normalized === 'string'
                ? normalized
                : JSON.stringify(normalized),
          },
        });
        const rawList = Array.isArray(response.data) ? response.data : [];
        const sorted = [...rawList].sort(
          (a, b) => Number(a?.cost ?? Infinity) - Number(b?.cost ?? Infinity),
        );
        this.logger.log(
          `Topship get-shipment-rate (linehaul) response: raw=${rawList.length}${sorted.length ? ` [${this.summarizeShipmentRateRows(sorted)}]` : ''}`,
        );
        return sorted;
      },
      );
      return rows;
    } catch (error: any) {
      this.logger.warn(
        `Topship get-shipment-rate (linehaul) failed: ${error?.message ?? error}`,
      );
      this.handleError(error, { quote: true });
    }
  }

  async getPickupRates(data: any) {
    const normalized = normalizeTopshipPickupRatePayload(data);
    const requestSummary = this.summarizePickupRateRequest(normalized);
    this.logger.log(
      `Topship get-pickup-rates request: ${JSON.stringify(requestSummary)}`,
    );
    try {
      const rows = await this.wrapQuotedRates('pickup', normalized, async () => {
        const response = await axios.get(`${this.baseUrl}/get-pickup-rates`, {
          headers: this.headers,
          ...this.quoteAxiosOpts(),
          params: {
            input:
              typeof normalized === 'string'
                ? normalized
                : JSON.stringify(normalized),
          },
        });
        const rawList = Array.isArray(response.data) ? response.data : [];
        const filtered = this.filterPickupRates(response.data);
        this.logger.log(
          `Topship get-pickup-rates response: raw=${rawList.length} filtered=${filtered.length}${filtered.length ? ` [${this.summarizePickupRateRows(filtered)}]` : ''}`,
        );
        if (rawList.length > 0 && filtered.length === 0) {
          this.logger.warn(
            `Topship get-pickup-rates returned ${rawList.length} row(s) but none matched chowdeck/glovo same-day after filter`,
          );
        }
        return filtered;
      });
      return rows;
    } catch (error: any) {
      this.logger.warn(
        `Topship get-pickup-rates failed: ${error?.message ?? error}`,
      );
      this.handleError(error, { quote: true });
    }
  }

  async getShipments(filter: any) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-shipments`, {
        headers: this.headers,
        timeout: this.httpTimeoutMs,
        params: { filter },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getShipmentById(id: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-shipment/${id}`, {
        headers: this.headers,
        timeout: this.httpTimeoutMs,
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async cancelShipment(id: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/cancel-shipment`,
        { id },
        { headers: this.headers, timeout: this.httpTimeoutMs },
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /** Public tracking reference (not the internal save-shipment / pay-from-wallet row id). */
  async trackShipment(trackingId: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/track-shipment`, {
        headers: this.headers,
        timeout: this.httpTimeoutMs,
        params: { trackingId },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getCountries() {
    try {
      const response = await axios.get(`${this.baseUrl}/get-countries`, {
        headers: this.headers,
        timeout: this.httpTimeoutMs,
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getStates(countryCode: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-states`, {
        headers: this.headers,
        timeout: this.httpTimeoutMs,
        params: { countryCode },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getCities(countryCode: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-cities`, {
        headers: this.headers,
        timeout: this.httpTimeoutMs,
        params: { countryCode },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async bookShipmentAsDraft(data: any) {
    try {
      const body = this.normalizeSaveShipmentPayload(data);
      const response = await axios.post(
        `${this.baseUrl}/save-shipment`,
        body,
        {
          headers: this.headers,
          timeout: this.httpTimeoutMs,
        },
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async bookShopAndShipAsDraft(data: any) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/save-shopnship`,
        data,
        {
          headers: this.headers,
          timeout: this.httpTimeoutMs,
        },
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async payForShipment(shipmentId: string) {
    const payBody = { detail: { shipmentId } };
    try {
      const response = await axios.post(
        `${this.baseUrl}/pay-from-wallet`,
        payBody,
        { headers: this.headers, timeout: this.httpTimeoutMs },
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  private handleError(error: any, opts?: { quote?: boolean }): never {
    const timeoutMs = opts?.quote ? this.quoteHttpTimeoutMs : this.httpTimeoutMs;
    const hint =
      error?.code === 'ECONNABORTED'
        ? ` (timeout after ${timeoutMs}ms${opts?.quote ? ', set TOPSHIP_QUOTE_HTTP_TIMEOUT_MS if needed' : ', set TOPSHIP_HTTP_TIMEOUT_MS if needed'})`
        : '';
    const data = error.response?.data;
    console.error(
      'Topship API error:',
      data || error.message,
      hint,
    );
    throw new InternalServerErrorException(
      error.response?.data?.message || 'Carrier API request failed',
    );
  }
}
