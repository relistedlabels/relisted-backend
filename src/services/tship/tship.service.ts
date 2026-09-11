import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { tshipApiConfigured } from 'src/constants/shipping-fulfillment-providers';
import {
  isEligibleTshipQuoteRate,
  TshipRateLike,
} from './tship-carrier-filter';
import {
  normalizeTshipCountryCode,
  normalizeTshipLine1,
  normalizeTshipPhone,
  normalizeTshipZip,
  resolveTshipCity,
  tshipApiErrorMessage,
} from './tship-address-normalize';

const DEFAULT_LIVE_BASE = 'https://api.terminal.africa/v1';
const DEFAULT_SANDBOX_BASE = 'https://sandbox.terminal.africa/v1';

export type TshipAddressInput = {
  name: string;
  email: string;
  phone: string;
  line1: string;
  /** Prefer street for line1 when both are set (avoids duplicated city in line1). */
  street?: string;
  city: string;
  state: string;
  country?: string;
  zip?: string;
};

export type TshipParcelInput = {
  description: string;
  valueNgn: number;
  weightKg?: number;
  itemName?: string;
};

export type TshipShipmentQuote = {
  rateId: string;
  carrierSlug: string;
  carrierName: string;
  totalNgn: number;
  deliveryTime?: string;
  raw: unknown;
};

export function isTshipPricingTier(tier: string | null | undefined): boolean {
  const t = String(tier ?? '').trim().toLowerCase();
  return t === 'tship' || t.startsWith('tship:');
}

export function tshipPricingTierSlug(carrierSlug: string): string {
  const slug = String(carrierSlug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `tship:${slug || 'carrier'}`;
}

export function tshipCarrierSlugFromPricingTier(
  tier: string | null | undefined,
): string {
  const t = String(tier ?? '').trim().toLowerCase();
  if (!t.startsWith('tship:')) return '';
  return t.slice('tship:'.length);
}

export function formatTshipCheckoutTierName(
  carrierName: string,
  carrierSlug?: string,
): string {
  const label =
    String(carrierName ?? '').trim() ||
    String(carrierSlug ?? '').trim() ||
    'Courier';
  return `${label} (via TShip)`;
}

function splitPersonName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: 'Relisted', last_name: 'Customer' };
  if (parts.length === 1) return { first_name: parts[0], last_name: 'Customer' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

@Injectable()
export class TshipService {
  private readonly logger = new Logger(TshipService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly httpTimeoutMs: number;
  private readonly quoteHttpTimeoutMs: number;

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
    const explicitBase = process.env.TERMINAL_API_BASE_URL?.trim();
    const useSandbox =
      process.env.TERMINAL_USE_SANDBOX?.trim() === '1' ||
      process.env.TERMINAL_USE_SANDBOX?.trim()?.toLowerCase() === 'true';
    this.baseUrl = (
      explicitBase ||
      (useSandbox ? DEFAULT_SANDBOX_BASE : DEFAULT_LIVE_BASE)
    ).replace(/\/$/, '');
    this.apiKey = process.env.TERMINAL_API_KEY?.trim() || '';
    this.httpTimeoutMs = Math.max(
      1000,
      Number(process.env.TERMINAL_HTTP_TIMEOUT_MS ?? 45_000),
    );
    this.quoteHttpTimeoutMs = Math.max(
      1000,
      Number(
        process.env.TERMINAL_QUOTE_HTTP_TIMEOUT_MS ??
          process.env.TERMINAL_HTTP_TIMEOUT_MS ??
          30_000,
      ),
    );
  }

  isConfigured(): boolean {
    return tshipApiConfigured();
  }

  quoteHttpTimeout(): number {
    return this.quoteHttpTimeoutMs;
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private axiosOpts(timeoutMs: number) {
    return {
      timeout: timeoutMs,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    };
  }

  private ensureConfigured() {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Terminal API key is not set');
    }
  }

  private terminalAddressPayload(input: TshipAddressInput) {
    const { first_name, last_name } = splitPersonName(input.name);
    return {
      city: resolveTshipCity(input.city, input.state),
      state: input.state.trim() || 'Lagos',
      country: normalizeTshipCountryCode(input.country),
      email: input.email.trim() || 'noreply@relisted.com',
      phone: normalizeTshipPhone(input.phone),
      line1: normalizeTshipLine1(input.street, input.line1),
      line2: '-',
      first_name,
      last_name,
      name: input.name.trim() || `${first_name} ${last_name}`,
      zip: normalizeTshipZip(input.zip),
      is_residential: true,
    };
  }

  private parcelPayload(input: TshipParcelInput) {
    const weight = Math.max(0.1, Number(input.weightKg ?? 1));
    const value = Math.max(1, Math.round(input.valueNgn));
    const itemName = (input.itemName ?? 'Relisted items').slice(0, 80);
    return {
      description: input.description.slice(0, 240) || 'Relisted items',
      weight_unit: 'kg',
      items: [
        {
          name: itemName,
          description: input.description.slice(0, 240) || 'Relisted items',
          weight,
          quantity: 1,
          value,
          currency: 'NGN',
        },
      ],
    };
  }

  private parseRateRow(row: Record<string, unknown>): TshipShipmentQuote | null {
    const rateId = String(row.rate_id ?? row.id ?? '').trim();
    if (!rateId) return null;
    const carrierSlug = String(row.carrier_slug ?? '').trim().toLowerCase();
    const carrierName = String(row.carrier_name ?? carrierSlug).trim();
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      rateId,
      carrierSlug,
      carrierName,
      totalNgn: amount,
      deliveryTime:
        row.delivery_time != null ? String(row.delivery_time) : undefined,
      raw: row,
    };
  }

  /**
   * POST /rates/shipment/quotes with persist_data so rate_id works on /shipments/pickup.
   */
  async fetchShipmentQuotes(
    input: {
      pickup: TshipAddressInput;
      delivery: TshipAddressInput;
      parcel: TshipParcelInput;
    },
    options?: { sameDayOnly?: boolean },
  ): Promise<TshipShipmentQuote[]> {
    this.ensureConfigured();
    const body = {
      pickup_address: this.terminalAddressPayload(input.pickup),
      delivery_address: this.terminalAddressPayload(input.delivery),
      parcel: this.parcelPayload(input.parcel),
      currency: 'NGN',
      persist_data: true,
    };

    const url = `${this.baseUrl}/rates/shipment/quotes`;
    this.logger.log(`Terminal T-Ship quote request ${url}`);

    let res;
    try {
      res = await axios.post(url, body, {
        ...this.axiosOpts(this.quoteHttpTimeoutMs),
        headers: this.authHeaders(),
      });
    } catch (err: unknown) {
      const detail = tshipApiErrorMessage(err);
      this.logger.warn(`Terminal T-Ship quote failed: ${detail}`);
      throw new Error(detail);
    }

    const data = (res.data as { data?: unknown })?.data;
    const rows = Array.isArray(data) ? data : [];
    const quotes: TshipShipmentQuote[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const parsed = this.parseRateRow(row as Record<string, unknown>);
      if (!parsed) continue;
      if (
        !isEligibleTshipQuoteRate(row as TshipRateLike, {
          sameDayOnly: options?.sameDayOnly !== false,
        })
      ) {
        continue;
      }
      quotes.push(parsed);
    }
    return quotes;
  }

  async fetchCheapestQuote(
    input: {
      pickup: TshipAddressInput;
      delivery: TshipAddressInput;
      parcel: TshipParcelInput;
      preferredCarrierSlug?: string;
    },
    options?: { sameDayOnly?: boolean },
  ): Promise<TshipShipmentQuote> {
    const quotes = await this.fetchShipmentQuotes(input, options);
    if (!quotes.length) {
      throw new Error('Terminal returned no eligible same-day courier rates');
    }
    const preferred = String(input.preferredCarrierSlug ?? '')
      .trim()
      .toLowerCase();
    const pool = preferred
      ? quotes.filter((q) => q.carrierSlug.includes(preferred))
      : quotes;
    const list = pool.length ? pool : quotes;
    return list.reduce((best, q) =>
      q.totalNgn < best.totalNgn ? q : best,
    );
  }

  async arrangePickup(rateId: string): Promise<unknown> {
    this.ensureConfigured();
    const id = String(rateId ?? '').trim();
    if (!id) throw new Error('Terminal rate_id is required');
    const url = `${this.baseUrl}/shipments/pickup`;
    const res = await axios.post(
      url,
      { rate_id: id },
      {
        ...this.axiosOpts(this.httpTimeoutMs),
        headers: this.authHeaders(),
      },
    );
    return res.data;
  }

  async trackShipment(shipmentId: string): Promise<unknown> {
    this.ensureConfigured();
    const id = encodeURIComponent(String(shipmentId ?? '').trim());
    const url = `${this.baseUrl}/shipments/track/${id}`;
    const res = await axios.get(url, {
      ...this.axiosOpts(this.httpTimeoutMs),
      headers: this.authHeaders(),
    });
    return res.data;
  }

  async cancelShipment(shipmentId: string): Promise<void> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/shipments/cancel`;
    await axios.post(
      url,
      { shipment_id: String(shipmentId ?? '').trim() },
      {
        ...this.axiosOpts(this.httpTimeoutMs),
        headers: this.authHeaders(),
      },
    );
  }
}
