import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { addDays } from 'date-fns';
import { shipbubbleApiConfigured } from 'src/constants/shipping-fulfillment-providers';
import { ShipbubbleAddressCacheService } from './shipbubble-address-cache.service';
import {
  isShipbubbleSandboxApiKey,
  sanitizeShipbubbleContactName,
  sanitizeShipbubblePhone,
  type ShipbubbleAddressContact,
} from './shipbubble-address-normalize';

export type { ShipbubbleAddressContact } from './shipbubble-address-normalize';
export {
  sanitizeShipbubbleContactName,
  sanitizeShipbubblePhone,
} from './shipbubble-address-normalize';

const DEFAULT_BASE = 'https://api.shipbubble.com/v1';

export type ShipbubbleValidatedAddress = {
  addressCode: number;
  formattedAddress: string;
  latitude?: number;
  longitude?: number;
  raw: unknown;
};

export type ShipbubbleCourierQuote = {
  courierId: string;
  serviceCode: string;
  courierName: string;
  totalNgn: number;
  requestToken: string;
  pickupEta?: string;
  deliveryEta?: string;
  raw: unknown;
};

export function isShipbubblePricingTier(tier: string | null | undefined): boolean {
  const t = String(tier ?? '').trim().toLowerCase();
  return t === 'shipbubble' || t.startsWith('shipbubble:');
}

export function shipbubblePricingTierSlug(serviceCode: string): string {
  const code = String(serviceCode ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_');
  return `shipbubble:${code || 'courier'}`;
}

export function formatShipbubbleCheckoutTierName(courierName: string): string {
  const label = String(courierName ?? '').trim() || 'Courier';
  return `${label} (via Shipbubble)`;
}

/** Same-day Shipbubble couriers we expose at checkout (matched on name and service_code). */
export const SHIPBUBBLE_ALLOWED_COURIER_KEYS = [
  'chowdeck',
  'glovo',
  'gokada',
] as const;

export { isShipbubbleSandboxApiKey } from './shipbubble-address-normalize';

export function isPickupShipbubbleCourier(
  courier: Record<string, unknown>,
): boolean {
  return String(courier.service_type ?? '').toLowerCase() !== 'dropoff';
}

export function isAllowedShipbubbleCourier(
  courier: Record<string, unknown>,
): boolean {
  const name = String(courier.courier_name ?? '').toLowerCase();
  const code = String(courier.service_code ?? '').toLowerCase();
  const normalized = `${name} ${code}`.replace(/[^a-z0-9]+/g, ' ');
  return SHIPBUBBLE_ALLOWED_COURIER_KEYS.some((key) => {
    if (key === 'gokada') {
      return (
        normalized.includes('gokada') || normalized.includes('go kada')
      );
    }
    return normalized.includes(key);
  });
}

/** Pickup quotes where delivery is same-day (hours / same calendar day), not multi-day. */
export function isSameDayShipbubbleCourier(
  courier: Record<string, unknown>,
  pickupDateYmd: string,
): boolean {
  if (String(courier.service_type ?? '').toLowerCase() === 'dropoff') {
    return false;
  }

  const deliveryEta = String(courier.delivery_eta ?? '').toLowerCase();
  const pickupEta = String(courier.pickup_eta ?? '').toLowerCase();

  if (deliveryEta.includes('same day') || deliveryEta.includes('same-day')) {
    return true;
  }

  if (
    /\b\d+\s*-\s*\d+\s*(working\s*)?days?\b/.test(deliveryEta) ||
    (/\bworking\s*days?\b/.test(deliveryEta) && !/\b(hrs?|hours?)\b/.test(deliveryEta))
  ) {
    return false;
  }

  if (/\b\d+\s*day(s)?\b/.test(deliveryEta) && !/\b(hrs?|hours?)\b/.test(deliveryEta)) {
    if (/\d+\s*-\s*\d+/.test(deliveryEta) || deliveryEta.includes('working')) {
      return false;
    }
  }

  if (/\bwithin\s+\d+\s*(hrs?|hours?)\b/.test(deliveryEta)) return true;
  if (/\b\d+\s*(hrs?|hours?)\b/.test(deliveryEta) && !deliveryEta.includes('day')) {
    return true;
  }
  if (/\bwithin\s+\d+\s*(hrs?|hours?)\b/.test(pickupEta)) return true;

  const deliveryTime = String(courier.delivery_eta_time ?? '').trim();
  if (deliveryTime.length >= 10 && pickupDateYmd) {
    if (deliveryTime.slice(0, 10) === pickupDateYmd) return true;
  }

  return false;
}

export type ShipbubblePackageItem = {
  name: string;
  description: string;
  unitWeightKg: string;
  unitAmountNgn: string;
  quantity: string;
};

@Injectable()
export class ShipbubbleService {
  private readonly logger = new Logger(ShipbubbleService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly httpTimeoutMs: number;
  private categoryIdCache: number | null = null;
  private readonly validateInFlight = new Map<
    string,
    Promise<ShipbubbleValidatedAddress>
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

  constructor(
    private readonly addressCache: ShipbubbleAddressCacheService,
  ) {
    this.baseUrl = (
      process.env.SHIPBUBBLE_API_BASE_URL || DEFAULT_BASE
    ).replace(/\/$/, '');
    this.apiKey = process.env.SHIPBUBBLE_API_KEY?.trim() || '';
    this.httpTimeoutMs = Math.max(
      1000,
      Number(process.env.SHIPBUBBLE_HTTP_TIMEOUT_MS ?? 45_000),
    );
  }

  isConfigured(): boolean {
    return shipbubbleApiConfigured();
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

  private formatYmdInLagos(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private lagosHour(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);
    return Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  }

  /**
   * Shipbubble schedules next-day processing after 6 PM GMT+1 when no explicit window.
   * @see https://docs.shipbubble.com/api-reference/rates/request-shipping-rates
   */
  resolvePickupDateYmd(scheduledWindowStart?: Date | null): string {
    const now = new Date();
    let base =
      scheduledWindowStart && scheduledWindowStart.getTime() > now.getTime()
        ? scheduledWindowStart
        : now;

    if (!scheduledWindowStart && this.lagosHour(now) >= 18) {
      base = addDays(now, 1);
    }

    const max = addDays(now, 7);
    if (base.getTime() > max.getTime()) {
      base = max;
    }

    return this.formatYmdInLagos(base);
  }

  private defaultPackageDimension() {
    return {
      length: Math.max(
        1,
        Number(process.env.SHIPBUBBLE_PACKAGE_LENGTH_CM ?? 30),
      ),
      width: Math.max(1, Number(process.env.SHIPBUBBLE_PACKAGE_WIDTH_CM ?? 20)),
      height: Math.max(
        1,
        Number(process.env.SHIPBUBBLE_PACKAGE_HEIGHT_CM ?? 10),
      ),
    };
  }

  private defaultItemWeightKg(): string {
    const w = Number(process.env.SHIPBUBBLE_DEFAULT_PACKAGE_WEIGHT_KG ?? 1);
    return String(Math.max(0.001, w));
  }

  /**
   * POST /shipping/address/validate
   * @see https://docs.shipbubble.com/api-reference/addresses/validate-address-global
   */
  async validateAddress(
    contact: ShipbubbleAddressContact,
    options?: { profileId?: string | null },
  ): Promise<ShipbubbleValidatedAddress> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Shipbubble API key is not set');
    }

    const address = String(contact.addressLine ?? '').trim();
    if (!address) {
      throw new InternalServerErrorException(
        'Shipbubble address validation requires a full address line',
      );
    }

    const cacheKey = this.addressCache.fingerprint(contact).addressHash;
    const cached = await this.addressCache.lookup(contact);
    if (cached) {
      this.logger.debug(
        `Shipbubble address cache hit (address_code=${cached.addressCode})`,
      );
      return cached;
    }

    const inFlight = this.validateInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.callValidateAddressApi(contact, address)
      .then(async (validated) => {
        await this.addressCache.save(contact, validated, options?.profileId);
        return validated;
      })
      .finally(() => {
        this.validateInFlight.delete(cacheKey);
      });

    this.validateInFlight.set(cacheKey, promise);
    return promise;
  }

  private async callValidateAddressApi(
    contact: ShipbubbleAddressContact,
    address: string,
  ): Promise<ShipbubbleValidatedAddress> {
    const body: Record<string, unknown> = {
      name: sanitizeShipbubbleContactName(contact.name, 'Relisted Customer'),
      email: contact.email || 'noreply@relisted.com',
      phone: sanitizeShipbubblePhone(contact.phone),
      address,
    };

    try {
      const res = await axios.post(
        `${this.baseUrl}/shipping/address/validate`,
        body,
        { headers: this.authHeaders(), ...this.axiosOpts() },
      );
      const payload = res.data;
      const data = payload?.data ?? payload;
      const addressCode = Number(data?.address_code);
      if (!Number.isFinite(addressCode) || addressCode <= 0) {
        throw new InternalServerErrorException(
          `Shipbubble address validation failed: ${JSON.stringify(payload)}`,
        );
      }
      return {
        addressCode,
        formattedAddress: String(
          data?.formatted_address ?? data?.formattedAddress ?? address,
        ),
        latitude:
          data?.latitude != null ? Number(data.latitude) : undefined,
        longitude:
          data?.longitude != null ? Number(data.longitude) : undefined,
        raw: payload,
      };
    } catch (err: any) {
      const msg = this.formatApiError(err, 'Shipbubble address validation failed');
      this.logger.warn(msg);
      throw new InternalServerErrorException(msg);
    }
  }

  /**
   * GET /shipping/labels/categories
   * @see https://docs.shipbubble.com/api-reference/package-categories
   */
  async resolveCategoryId(): Promise<number> {
    const fromEnv = Number(process.env.SHIPBUBBLE_CATEGORY_ID);
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
      return fromEnv;
    }
    if (this.categoryIdCache != null) {
      return this.categoryIdCache;
    }

    if (!this.apiKey) {
      throw new InternalServerErrorException('Shipbubble API key is not set');
    }

    const preferredName = (
      process.env.SHIPBUBBLE_CATEGORY_NAME || 'Fashion wears'
    )
      .trim()
      .toLowerCase();

    const res = await axios.get(`${this.baseUrl}/shipping/labels/categories`, {
      headers: this.authHeaders(),
      ...this.axiosOpts(),
    });
    const rows = (res.data?.data ?? res.data) as Array<{
      category_id?: number;
      category?: string;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new InternalServerErrorException(
        'Shipbubble returned no package categories',
      );
    }

    const match =
      rows.find(
        (r) =>
          String(r.category ?? '')
            .trim()
            .toLowerCase() === preferredName,
      ) ?? rows[0];
    const id = Number(match?.category_id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new InternalServerErrorException(
        'Shipbubble category_id missing in categories response',
      );
    }
    this.categoryIdCache = id;
    return id;
  }

  private courierRowToQuote(
    courier: Record<string, unknown>,
    requestToken: string,
    raw: unknown,
  ): ShipbubbleCourierQuote {
    const serviceCode = String(courier.service_code ?? '').trim();
    const courierIdRaw = courier.courier_id;
    const courierId =
      courierIdRaw != null ? String(courierIdRaw).trim() : '';
    const totalNgn = Number(courier.total ?? courier.rate_card_amount);
    if (!serviceCode || !courierId || !Number.isFinite(totalNgn)) {
      throw new InternalServerErrorException(
        `Shipbubble courier row incomplete: ${JSON.stringify(courier)}`,
      );
    }
    return {
      courierId,
      serviceCode,
      courierName: String(courier.courier_name ?? 'Courier'),
      totalNgn,
      requestToken,
      pickupEta:
        courier.pickup_eta != null ? String(courier.pickup_eta) : undefined,
      deliveryEta:
        courier.delivery_eta != null ? String(courier.delivery_eta) : undefined,
      raw,
    };
  }

  private listAllowedPickupCouriers(
    data: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const couriers = Array.isArray(data.couriers)
      ? (data.couriers as Record<string, unknown>[])
      : [];
    const allowed = isShipbubbleSandboxApiKey(this.apiKey)
      ? couriers.filter((c) => isPickupShipbubbleCourier(c))
      : couriers.filter((c) => isAllowedShipbubbleCourier(c));
    allowed.sort((a, b) => {
      const at = Number(a?.total ?? a?.rate_card_amount ?? Infinity);
      const bt = Number(b?.total ?? b?.rate_card_amount ?? Infinity);
      return at - bt;
    });
    return allowed;
  }

  private listSameDayPickupCouriers(
    data: Record<string, unknown>,
    pickupDateYmd: string,
  ): Record<string, unknown>[] {
    if (isShipbubbleSandboxApiKey(this.apiKey)) {
      return this.listAllowedPickupCouriers(data);
    }

    const couriers = Array.isArray(data.couriers)
      ? (data.couriers as Record<string, unknown>[])
      : [];
    const sameDay = couriers.filter(
      (c) =>
        isSameDayShipbubbleCourier(c, pickupDateYmd) &&
        isAllowedShipbubbleCourier(c),
    );
    sameDay.sort((a, b) => {
      const at = Number(a?.total ?? a?.rate_card_amount ?? Infinity);
      const bt = Number(b?.total ?? b?.rate_card_amount ?? Infinity);
      return at - bt;
    });
    return sameDay;
  }

  /**
   * POST /shipping/fetch_rates
   * @see https://docs.shipbubble.com/api-reference/rates/request-shipping-rates
   *
   * When `sameDayOnly` is false (return leg with a future pickup window), all allowed
   * couriers for the requested `pickup_date` are returned so pricing matches the
   * scheduled return date, not only same-calendar-day options.
   */
  async fetchPickupQuotes(
    input: {
      sender: ShipbubbleAddressContact;
      receiver: ShipbubbleAddressContact;
      packageItems: ShipbubblePackageItem[];
      pickupDateYmd?: string;
      scheduledWindowStart?: Date | null;
    },
    options?: { sameDayOnly?: boolean },
  ): Promise<ShipbubbleCourierQuote[]> {
    const payload = await this.fetchRatesPayload(input);
    const data = payload.data;
    const requestToken = payload.requestToken;
    const pickupDate = payload.pickupDateYmd;

    const sameDayOnly = options?.sameDayOnly !== false;
    const couriers = sameDayOnly
      ? this.listSameDayPickupCouriers(data, pickupDate)
      : this.listAllowedPickupCouriers(data);
    if (!couriers.length) {
      throw new InternalServerErrorException(
        sameDayOnly
          ? 'Shipbubble has no same-day Chowdeck, Glovo, or Gokada pickup options for this route'
          : 'Shipbubble has no Chowdeck, Glovo, or Gokada pickup options for this route on the selected pickup date',
      );
    }

    return couriers.map((c) =>
      this.courierRowToQuote(c, requestToken, payload.raw),
    );
  }

  /**
   * POST /shipping/fetch_rates
   * @see https://docs.shipbubble.com/api-reference/rates/request-shipping-rates
   */
  async fetchSameDayPickupQuotes(input: {
    sender: ShipbubbleAddressContact;
    receiver: ShipbubbleAddressContact;
    packageItems: ShipbubblePackageItem[];
    pickupDateYmd?: string;
    scheduledWindowStart?: Date | null;
  }): Promise<ShipbubbleCourierQuote[]> {
    return this.fetchPickupQuotes(input, { sameDayOnly: true });
  }

  /**
   * POST /shipping/fetch_rates
   * @see https://docs.shipbubble.com/api-reference/rates/request-shipping-rates
   */
  async fetchCheapestPickupQuote(
    input: {
      sender: ShipbubbleAddressContact;
      receiver: ShipbubbleAddressContact;
      packageItems: ShipbubblePackageItem[];
      pickupDateYmd?: string;
      scheduledWindowStart?: Date | null;
    },
    options?: { sameDayOnly?: boolean },
  ): Promise<ShipbubbleCourierQuote> {
    const quotes = await this.fetchPickupQuotes(input, options);
    return quotes[0];
  }

  private isInvalidShipbubbleAddressCodeError(message: string): boolean {
    const m = message.toLowerCase();
    return (
      m.includes('invalid sender address code') ||
      m.includes('invalid receiver address code') ||
      m.includes('invalid reciever address code')
    );
  }

  private async fetchRatesPayload(input: {
    sender: ShipbubbleAddressContact;
    receiver: ShipbubbleAddressContact;
    packageItems: ShipbubblePackageItem[];
    pickupDateYmd?: string;
    scheduledWindowStart?: Date | null;
  }): Promise<{
    data: Record<string, unknown>;
    requestToken: string;
    pickupDateYmd: string;
    raw: unknown;
  }> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Shipbubble API key is not set');
    }

    const pickupDateYmd =
      input.pickupDateYmd ??
      this.resolvePickupDateYmd(input.scheduledWindowStart);
    const categoryId = await this.resolveCategoryId();

    const postFetchRates = async (
      senderValidated: ShipbubbleValidatedAddress,
      receiverValidated: ShipbubbleValidatedAddress,
    ) => {
      const body = {
        sender_address_code: senderValidated.addressCode,
        reciever_address_code: receiverValidated.addressCode,
        pickup_date: pickupDateYmd,
        category_id: categoryId,
        package_items: input.packageItems.map((item) => ({
          name: item.name,
          description: item.description,
          unit_weight: item.unitWeightKg,
          unit_amount: item.unitAmountNgn,
          quantity: item.quantity,
        })),
        package_dimension: this.defaultPackageDimension(),
        service_type: 'pickup',
      };

      const res = await axios.post(
        `${this.baseUrl}/shipping/fetch_rates`,
        body,
        { headers: this.authHeaders(), ...this.axiosOpts() },
      );
      const payload = res.data;
      const data = (payload?.data ?? payload) as Record<string, unknown>;
      const requestToken = String(data?.request_token ?? '').trim();
      if (!requestToken) {
        throw new InternalServerErrorException(
          `Shipbubble fetch_rates missing request_token: ${JSON.stringify(payload)}`,
        );
      }
      return { data, requestToken, pickupDateYmd, raw: payload };
    };

    const validatePair = async () => {
      let senderValidated: ShipbubbleValidatedAddress;
      let receiverValidated: ShipbubbleValidatedAddress;
      try {
        senderValidated = await this.validateAddress(input.sender);
      } catch (err: any) {
        const msg =
          err instanceof InternalServerErrorException
            ? String(err.message)
            : this.formatApiError(err, 'Shipbubble address validation failed');
        throw new InternalServerErrorException(
          `${msg} (sender: ${input.sender.addressLine})`,
        );
      }
      try {
        receiverValidated = await this.validateAddress(input.receiver);
      } catch (err: any) {
        const msg =
          err instanceof InternalServerErrorException
            ? String(err.message)
            : this.formatApiError(err, 'Shipbubble address validation failed');
        throw new InternalServerErrorException(
          `${msg} (receiver: ${input.receiver.addressLine})`,
        );
      }
      return { senderValidated, receiverValidated };
    };

    let { senderValidated, receiverValidated } = await validatePair();

    try {
      return await postFetchRates(senderValidated, receiverValidated);
    } catch (err: any) {
      if (err instanceof InternalServerErrorException) throw err;
      const msg = this.formatApiError(err, 'Shipbubble fetch_rates failed');
      if (this.isInvalidShipbubbleAddressCodeError(msg)) {
        this.logger.warn(
          `${msg} — clearing Shipbubble address cache and re-validating once`,
        );
        await Promise.all([
          this.addressCache.invalidate(input.sender),
          this.addressCache.invalidate(input.receiver),
        ]);
        ({ senderValidated, receiverValidated } = await validatePair());
        try {
          return await postFetchRates(senderValidated, receiverValidated);
        } catch (retryErr: any) {
          if (retryErr instanceof InternalServerErrorException) {
            throw retryErr;
          }
          const retryMsg = this.formatApiError(
            retryErr,
            'Shipbubble fetch_rates failed',
          );
          this.logger.warn(retryMsg);
          throw new InternalServerErrorException(retryMsg);
        }
      }
      this.logger.warn(msg);
      throw new InternalServerErrorException(msg);
    }
  }

  /**
   * POST /shipping/labels
   * @see https://docs.shipbubble.com/api-reference/shipments/create-shipment
   */
  async createLabel(input: {
    requestToken: string;
    serviceCode: string;
    courierId: string;
  }): Promise<unknown> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Shipbubble API key is not set');
    }
    try {
      const res = await axios.post(
        `${this.baseUrl}/shipping/labels`,
        {
          request_token: input.requestToken,
          service_code: input.serviceCode,
          courier_id: input.courierId,
        },
        { headers: this.authHeaders(), ...this.axiosOpts() },
      );
      return res.data;
    } catch (err: any) {
      const msg = this.formatApiError(err, 'Shipbubble create label failed');
      throw new InternalServerErrorException(msg);
    }
  }

  /**
   * GET /shipping/labels/list/:order_ids
   * @see https://docs.shipbubble.com/api-reference/tracking/get-multiple-specific-shipments
   */
  async getShipmentByOrderId(orderId: string): Promise<unknown> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Shipbubble API key is not set');
    }
    const id = encodeURIComponent(String(orderId).trim());
    const res = await axios.get(`${this.baseUrl}/shipping/labels/list/${id}`, {
      headers: this.authHeaders(),
      ...this.axiosOpts(),
    });
    return res.data;
  }

  /**
   * POST /shipping/labels/cancel/:order_id
   * @see https://docs.shipbubble.com/api-reference/shipments/cancel-shipment
   */
  async cancelLabel(orderId: string): Promise<void> {
    if (!this.apiKey) {
      throw new InternalServerErrorException('Shipbubble API key is not set');
    }
    const id = encodeURIComponent(String(orderId).trim());
    await axios.post(
      `${this.baseUrl}/shipping/labels/cancel/${id}`,
      {},
      { headers: this.authHeaders(), ...this.axiosOpts() },
    );
  }

  buildDefaultPackageItems(
    lines: Array<{ name: string; valueNgn: number }>,
  ): ShipbubblePackageItem[] {
    const weight = this.defaultItemWeightKg();
    if (!lines.length) {
      return [
        {
          name: 'Relisted items',
          description: 'Relisted rental or resale delivery',
          unitWeightKg: weight,
          unitAmountNgn: '1000',
          quantity: '1',
        },
      ];
    }
    return lines.map((line) => ({
      name: line.name.slice(0, 80) || 'Item',
      description: 'Relisted order item',
      unitWeightKg: weight,
      unitAmountNgn: String(Math.max(1, Math.round(line.valueNgn))),
      quantity: '1',
    }));
  }

  private formatApiError(err: any, fallback: string): string {
    const data = err?.response?.data;
    const msg =
      data?.message ||
      (Array.isArray(data?.errors) ? data.errors.join('; ') : null) ||
      data?.error ||
      err?.message ||
      fallback;
    return String(msg);
  }
}
