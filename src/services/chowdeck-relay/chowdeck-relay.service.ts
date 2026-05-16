import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { chowdeckRelayApiConfigured } from 'src/constants/shipping-fulfillment-providers';
import { NominatimGeocodeService } from '../geocoding/nominatim-geocode.service';

const DEFAULT_BASE = 'https://api.chowdeck.com/relay';

@Injectable()
export class ChowdeckRelayService {
  private readonly logger = new Logger(ChowdeckRelayService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly httpTimeoutMs: number;

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

  constructor(private readonly nominatim: NominatimGeocodeService) {
    this.baseUrl = (
      process.env.CHOWDECK_RELAY_API_BASE_URL || DEFAULT_BASE
    ).replace(/\/$/, '');
    this.apiKey = process.env.CHOWDECK_API_KEY?.trim() || '';
    this.httpTimeoutMs = Math.max(
      1000,
      Number(process.env.CHOWDECK_HTTP_TIMEOUT_MS ?? 45_000),
    );
  }

  isConfigured(): boolean {
    return chowdeckRelayApiConfigured();
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private axiosOpts() {
    return {
      timeout: this.httpTimeoutMs,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    };
  }

  /**
   * POST /relay/delivery/fee — see
   * https://chowdeck.readme.io/reference/get-delivery-fee
   */
  async getDeliveryFee(input: {
    sourceAddressString: string;
    destinationAddressString: string;
    estimatedOrderAmountKobo?: number;
  }): Promise<{ feeId: number; totalAmountKobo: number; raw: unknown }> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Chowdeck Relay API key is not set');
    }
    const body: Record<string, unknown> = {
      source_address_string: input.sourceAddressString,
      destination_address_string: input.destinationAddressString,
      estimated_order_amount: Math.max(
        0,
        Math.round(input.estimatedOrderAmountKobo ?? 0),
      ),
    };

    // Relay fee quotes need lat/lng; Chowdeck's string geocoder often fails on partial NG addresses.
    const [srcPt, dstPt] = await Promise.all([
      this.nominatim.geocodeAddressLine(input.sourceAddressString),
      this.nominatim.geocodeAddressLine(input.destinationAddressString),
    ]);
    if (!srcPt || !dstPt) {
      const missing = [
        !srcPt ? 'pickup' : null,
        !dstPt ? 'delivery' : null,
      ]
        .filter(Boolean)
        .join(' and ');
      throw new InternalServerErrorException(
        `Could not resolve ${missing} coordinates for Chowdeck Relay. Check city and state on the profile address (street, area, city, state).`,
      );
    }
    body.source_address = {
      latitude: srcPt.lat,
      longitude: srcPt.lng,
    };
    body.destination_address = {
      latitude: dstPt.lat,
      longitude: dstPt.lng,
    };

    try {
      const res = await axios.post(
        `${this.baseUrl}/delivery/fee`,
        body,
        { headers: this.authHeaders(), ...this.axiosOpts() },
      );
      const payload = res.data;
      const data = payload?.data ?? payload;
      const feeId = Number(data?.id);
      const totalAmountKobo = Number(
        data?.total_amount ?? data?.totalAmount ?? 0,
      );
      if (!Number.isFinite(feeId) || feeId <= 0) {
        throw new InternalServerErrorException(
          `Chowdeck Relay fee response missing id: ${JSON.stringify(payload)}`,
        );
      }
      if (!Number.isFinite(totalAmountKobo) || totalAmountKobo < 0) {
        throw new InternalServerErrorException(
          `Chowdeck Relay fee response missing total_amount: ${JSON.stringify(payload)}`,
        );
      }
      return { feeId, totalAmountKobo, raw: payload };
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      const msg =
        data?.message ||
        data?.error ||
        err?.message ||
        'Chowdeck Relay fee request failed';
      this.logger.warn(
        `Relay delivery/fee failed (HTTP ${status ?? 'n/a'}): ${msg}${
          data && typeof data === 'object'
            ? ` — ${JSON.stringify(data)}`
            : ''
        }`,
      );
      throw new InternalServerErrorException(msg);
    }
  }

  /**
   * POST /relay/delivery — see
   * https://chowdeck.readme.io/reference/create-delivery
   */
  async createDelivery(body: Record<string, unknown>): Promise<unknown> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Chowdeck Relay API key is not set');
    }
    try {
      const res = await axios.post(`${this.baseUrl}/delivery`, body, {
        headers: this.authHeaders(),
        ...this.axiosOpts(),
      });
      return res.data;
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Chowdeck Relay create delivery failed';
      const wrapped = new InternalServerErrorException(msg);
      (wrapped as any).cause = err?.response?.data;
      throw wrapped;
    }
  }

  /**
   * GET /relay/delivery/{reference} — see
   * https://chowdeck.readme.io/reference/get-delivery
   */
  async getDeliveryByReference(reference: string): Promise<unknown> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Chowdeck Relay API key is not set');
    }
    const ref = encodeURIComponent(String(reference).trim());
    const res = await axios.get(`${this.baseUrl}/delivery/${ref}`, {
      headers: this.authHeaders(),
      ...this.axiosOpts(),
    });
    return res.data;
  }

  /**
   * POST /relay/delivery/{reference}/cancel — see
   * https://chowdeck.readme.io/reference/cancel-relay-delivery
   */
  async cancelDelivery(reference: string, reason: string): Promise<void> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Chowdeck Relay API key is not set');
    }
    const ref = encodeURIComponent(String(reference).trim());
    await axios.post(
      `${this.baseUrl}/delivery/${ref}/cancel`,
      { reason: reason || 'Cancelled by merchant' },
      { headers: this.authHeaders(), ...this.axiosOpts() },
    );
  }
}
