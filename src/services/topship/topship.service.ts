import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import https from 'https';

@Injectable()
export class TopshipService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  /** Hard cap per HTTP call so checkout summary cannot hang on a stalled upstream (axios default is no timeout). */
  private readonly httpTimeoutMs: number;
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
    this.quoteCacheTtlMs = Math.max(
      0,
      Number(process.env.TOPSHIP_QUOTE_CACHE_TTL_MS ?? 0),
    );
  }

  private quoteAxiosOpts() {
    return {
      timeout: this.httpTimeoutMs,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    };
  }

  private wrapQuotedRates(
    kind: 'pickup' | 'ship',
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
    if (!t || t === 'budget' || t === 'standard') return 'Chowdeck';
    if (t === 'chowdeck') return 'Chowdeck';
    if (t === 'glovo') return 'Glovo';
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
        pricingTier: this.toGraphqlPricingTierType(row?.pricingTier),
        pickupPartner: this.toGraphqlPricingTierType(
          row?.pickupPartner ?? row?.pricingTier,
        ),
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

  async getShipmentRate(data: any): Promise<any[]> {
    try {
      const rows = await this.wrapQuotedRates('ship', data, async () => {
        const response = await axios.get(`${this.baseUrl}/get-shipment-rate`, {
          headers: this.headers,
          ...this.quoteAxiosOpts(),
          params: {
            shipmentDetail:
              typeof data === 'string' ? data : JSON.stringify(data),
          },
        });
        return this.filterShipmentRates(response.data);
      });
      return rows;
    } catch (error: any) {
      this.handleError(error);
      return [];
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

  async getPickupRates(data: any) {
    try {
      const rows = await this.wrapQuotedRates('pickup', data, async () => {
        const response = await axios.get(`${this.baseUrl}/get-pickup-rates`, {
          headers: this.headers,
          ...this.quoteAxiosOpts(),
          params: {
            input: typeof data === 'string' ? data : JSON.stringify(data),
          },
        });
        return this.filterPickupRates(response.data);
      });
      return rows;
    } catch (error: any) {
      this.handleError(error);
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
    try {
      const response = await axios.post(
        `${this.baseUrl}/pay-from-wallet`,
        { detail: { shipmentId } },
        { headers: this.headers, timeout: this.httpTimeoutMs },
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  private handleError(error: any) {
    const hint =
      error?.code === 'ECONNABORTED'
        ? ` (timeout after ${this.httpTimeoutMs}ms, set TOPSHIP_HTTP_TIMEOUT_MS if needed)`
        : '';
    console.error(
      'Topship API error:',
      error.response?.data || error.message,
      hint,
    );
    throw new InternalServerErrorException(
      error.response?.data?.message || 'Topship API request failed',
    );
  }
}
