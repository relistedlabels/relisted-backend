import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Shipment, ShipmentType } from '@prisma/client';
import {
  AdminRatePreviewProvider,
  ADMIN_RATE_PREVIEW_CHOWDECK_RELAY,
  ADMIN_RATE_PREVIEW_SHIPBUBBLE,
  ADMIN_RATE_PREVIEW_TOPSHIP,
  ADMIN_RATE_PREVIEW_TSHIP,
} from 'src/constants/admin-rate-preview-providers';
import {
  chowdeckRelayQuotesAvailable,
  shipbubbleQuotesAvailable,
  topshipAdminQuotesAvailable,
  tshipQuotesAvailable,
} from 'src/constants/shipping-fulfillment-providers';
import {
  RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO,
  RELISTED_DISPATCH_SHIPPING_LABEL,
} from 'src/constants/relisted-dispatch-shipping';
import { ShippingQuoteWarning } from 'src/constants/shipping-quote-warnings';
import { ChowdeckRelayService } from 'src/services/chowdeck-relay/chowdeck-relay.service';
import { formatShipbubbleAddressLine } from 'src/services/shipbubble/shipbubble-address-normalize';
import {
  formatShipbubbleCheckoutTierName,
  isShipbubblePricingTier,
  sanitizeShipbubbleContactName,
  sanitizeShipbubblePhone,
  shipbubblePricingTierSlug,
  ShipbubbleService,
} from 'src/services/shipbubble/shipbubble.service';
import { TopshipService } from 'src/services/topship/topship.service';
import {
  formatTshipCheckoutTierName,
  isTshipPricingTier,
  TshipService,
  tshipPricingTierSlug,
} from 'src/services/tship/tship.service';
import {
  buildTopshipSenderDetail,
  resolveTopshipCityName,
} from 'src/services/topship/topship-city';
import { PrismaService } from 'src/services/prisma/prisma.service';
import {
  buildDefaultDispatchWindow,
  buildDefaultReturnDispatchWindow,
} from 'src/utils/dispatch-windows';
import { selectOrderItemsForShipmentLeg } from './order-items-for-shipment-leg';

export type ShipmentRateTier = {
  pricingTier: string;
  name: string;
  shipmentChargeKobo: number;
  pickupChargeKobo: number;
  vatChargeKobo: number;
  totalCostKobo: number;
  deltaKobo: number;
  description?: string;
  shipbubbleRequestToken?: string;
  shipbubbleCourierId?: string;
  /** Topship get-pickup-rates pickup id (Chowdeck/Glovo). */
  topshipPickupId?: string;
  /** Terminal T-Ship rate_id from POST /rates/shipment/quotes. */
  tshipRateId?: string;
};

export type ShipmentRatePreviewData = {
  tiers: ShipmentRateTier[];
  warnings: ShippingQuoteWarning[];
  renterChargedKobo: number;
  quoteWindowStart: string;
  storedWindowStart: string | null;
  forImmediate: boolean;
};

export type ShipmentRatePreviewProviderSlice = ShipmentRatePreviewData & {
  provider: AdminRatePreviewProvider;
  /** False when API key or env gate skips this source (no fetch attempted). */
  available: boolean;
};

type AddressSnapshot = Record<string, unknown>;

@Injectable()
export class ShipmentQuoteService {
  private readonly logger = new Logger(ShipmentQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly topshipService: TopshipService,
    private readonly chowdeckRelayService: ChowdeckRelayService,
    private readonly shipbubbleService: ShipbubbleService,
    private readonly tshipService: TshipService,
  ) {}

  async previewRates(
    shipmentId: string,
    forImmediate = false,
  ): Promise<ShipmentRatePreviewData> {
    const shipment = await this.loadShipmentForQuote(shipmentId);
    const quoteWindowStart = this.resolveQuoteWindowStart(shipment, forImmediate);
    const renterChargedKobo = this.renterChargedKobo(shipment);
    const warnings: ShippingQuoteWarning[] = [];
    const rawRates = await this.fetchRawRates(
      shipment,
      quoteWindowStart,
      warnings,
    );
    const tiers = this.buildTierCards(rawRates, renterChargedKobo);

    return {
      tiers,
      warnings,
      renterChargedKobo,
      quoteWindowStart: quoteWindowStart.toISOString(),
      storedWindowStart: shipment.scheduledWindowStart?.toISOString() ?? null,
      forImmediate,
    };
  }

  /** One carrier source for admin UI progressive rate loading. */
  async previewRatesForProvider(
    shipmentId: string,
    provider: AdminRatePreviewProvider,
    forImmediate = false,
  ): Promise<ShipmentRatePreviewProviderSlice> {
    const shipment = await this.loadShipmentForQuote(shipmentId);
    const quoteWindowStart = this.resolveQuoteWindowStart(shipment, forImmediate);
    const renterChargedKobo = this.renterChargedKobo(shipment);
    const meta = {
      renterChargedKobo,
      quoteWindowStart: quoteWindowStart.toISOString(),
      storedWindowStart: shipment.scheduledWindowStart?.toISOString() ?? null,
      forImmediate,
    };
    const warnings: ShippingQuoteWarning[] = [];
    const rawRates = await this.fetchRawRatesForProvider(
      provider,
      shipment,
      quoteWindowStart,
      warnings,
    );
    if (rawRates === null) {
      return {
        ...meta,
        provider,
        available: false,
        tiers: [],
        warnings: [],
      };
    }
    const tiers = this.buildTierCards(rawRates, renterChargedKobo);
    return {
      ...meta,
      provider,
      available: true,
      tiers,
      warnings,
    };
  }

  listAdminRatePreviewProviders(): AdminRatePreviewProvider[] {
    const all: AdminRatePreviewProvider[] = [
      ADMIN_RATE_PREVIEW_SHIPBUBBLE,
      ADMIN_RATE_PREVIEW_TOPSHIP,
      ADMIN_RATE_PREVIEW_CHOWDECK_RELAY,
      ADMIN_RATE_PREVIEW_TSHIP,
    ];
    return all.filter((p) => this.isAdminRatePreviewProviderAvailable(p));
  }

  private isAdminRatePreviewProviderAvailable(
    provider: AdminRatePreviewProvider,
  ): boolean {
    switch (provider) {
      case ADMIN_RATE_PREVIEW_TOPSHIP:
        return topshipAdminQuotesAvailable();
      case ADMIN_RATE_PREVIEW_SHIPBUBBLE:
        return shipbubbleQuotesAvailable();
      case ADMIN_RATE_PREVIEW_CHOWDECK_RELAY:
        return chowdeckRelayQuotesAvailable();
      case ADMIN_RATE_PREVIEW_TSHIP:
        return tshipQuotesAvailable();
      default:
        return false;
    }
  }

  findTierInPreview(
    tiers: ShipmentRateTier[],
    pricingTier: string,
  ): ShipmentRateTier | null {
    const normalized = pricingTier.trim().toLowerCase();
    return (
      tiers.find(
        (t) =>
          t.pricingTier.trim().toLowerCase() === normalized ||
          t.name.trim().toLowerCase() === normalized,
      ) ?? null
    );
  }

  tierToShipmentCharges(tier: ShipmentRateTier): {
    pricingTier: string;
    shipmentCharge: number;
    pickupCharge: number;
    vatCharge: number;
    pickupId: string | null;
    pickupPartner: string | null;
  } {
    const slug = this.slugForCheckoutShippingTier(tier.pricingTier);
    let pickupId: string | null = null;
    let pickupPartner: string | null = null;
    if (isShipbubblePricingTier(tier.pricingTier)) {
      pickupId = tier.shipbubbleRequestToken?.trim() || null;
      pickupPartner = tier.shipbubbleCourierId?.trim() || null;
    } else if (isTshipPricingTier(tier.pricingTier)) {
      pickupId = tier.tshipRateId?.trim() || null;
      pickupPartner =
        tier.pricingTier.slice('tship:'.length).trim() || null;
    } else if (slug === 'chowdeck' || slug === 'glovo') {
      pickupPartner = this.normalizeTopshipTier(tier.pricingTier);
      pickupId = tier.topshipPickupId?.trim() || null;
    } else if (slug && slug !== 'relisted_dispatch') {
      pickupPartner = this.normalizeTopshipTier(tier.pricingTier);
    }
    return {
      pricingTier: tier.pricingTier,
      shipmentCharge: tier.shipmentChargeKobo,
      pickupCharge: tier.pickupChargeKobo,
      vatCharge: tier.vatChargeKobo,
      pickupId,
      pickupPartner,
    };
  }

  private async loadShipmentForQuote(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: {
          include: {
            orderItems: {
              include: {
                product: {
                  select: {
                    name: true,
                    dailyPrice: true,
                    resalePrice: true,
                    originalValue: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  private resolveQuoteWindowStart(
    shipment: Pick<Shipment, 'type' | 'scheduledWindowStart' | 'scheduledDate'>,
    forImmediate: boolean,
  ): Date {
    if (forImmediate) {
      const now = new Date();
      return shipment.type === 'RETURN'
        ? buildDefaultReturnDispatchWindow(now).start
        : buildDefaultDispatchWindow(now).start;
    }
    if (shipment.scheduledWindowStart) {
      return new Date(shipment.scheduledWindowStart);
    }
    return new Date(shipment.scheduledDate);
  }

  private renterChargedKobo(
    shipment: Pick<Shipment, 'shipmentCharge' | 'pickupCharge' | 'vatCharge'>,
  ): number {
    return (
      (shipment.shipmentCharge ?? 0) +
      (shipment.pickupCharge ?? 0) +
      (shipment.vatCharge ?? 0)
    );
  }

  private asAddress(json: unknown): AddressSnapshot {
    return json && typeof json === 'object' ? (json as AddressSnapshot) : {};
  }

  private formatAddressLine(snapshot: AddressSnapshot): string {
    return [snapshot.street, snapshot.city, snapshot.state]
      .map((p) => (p != null ? String(p).trim() : ''))
      .filter(Boolean)
      .join(', ');
  }

  private estimateOrderValueKobo(
    shipment: Awaited<ReturnType<typeof this.loadShipmentForQuote>>,
  ): number {
    const orderItems = shipment.order?.orderItems;
    if (!orderItems?.length) return 0;
    const items = selectOrderItemsForShipmentLeg(
      shipment.id,
      shipment.type,
      orderItems as Parameters<typeof selectOrderItemsForShipmentLeg>[2],
    );
    let ngn = 0;
    for (const it of items || []) {
      const row = it as {
        days?: number;
        product?: {
          dailyPrice?: number | null;
          resalePrice?: number | null;
          originalValue?: number | null;
        } | null;
      };
      const p = row.product;
      if (!p) continue;
      if ((row.days ?? 0) > 0 && p.dailyPrice) {
        ngn += Number(p.dailyPrice) * (Number(row.days) || 0);
      } else if (p.resalePrice) {
        ngn += Number(p.resalePrice);
      } else if (p.originalValue) {
        ngn += Number(p.originalValue);
      }
    }
    return Math.round(Math.max(0, ngn) * 100);
  }

  private async fetchRawRates(
    shipment: Awaited<ReturnType<typeof this.loadShipmentForQuote>>,
    quoteWindowStart: Date,
    warnings: ShippingQuoteWarning[],
  ): Promise<any[]> {
    const pickup = this.asAddress(shipment.pickupAddress);
    const delivery = this.asAddress(shipment.deliveryAddress);
    const leg: ShippingQuoteWarning['leg'] =
      shipment.type === 'RETURN' ? 'return' : 'outbound';
    const packageValueNgn = Math.round(this.estimateOrderValueKobo(shipment) / 100);

    if (!topshipAdminQuotesAvailable()) {
      this.logger.log(
        'Admin rate preview: skipping Topship (TOPSHIP_API_KEY unset)',
      );
    }

    const sourceLine = this.formatAddressLine(pickup);
    const destLine = this.formatAddressLine(delivery);

    const fetches: Promise<any[]>[] = [];
    if (topshipAdminQuotesAvailable()) {
      fetches.push(
        this.fetchTopshipPartnerRates(
          pickup,
          delivery,
          quoteWindowStart,
          warnings,
          leg,
        ),
      );
    }
    fetches.push(
      this.fetchChowdeckRelayRateRows(
        sourceLine,
        destLine,
        this.estimateOrderValueKobo(shipment),
        warnings,
        leg,
      ),
      this.fetchShipbubbleRateRows(
        pickup,
        delivery,
        packageValueNgn,
        quoteWindowStart,
        warnings,
        leg,
        shipment.type,
      ),
      this.fetchTshipRateRows(
        pickup,
        delivery,
        packageValueNgn,
        warnings,
        leg,
        shipment.type,
      ),
    );

    const settled = await Promise.allSettled(fetches);
    const rateData: any[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        rateData.push(...result.value);
      } else {
        this.logger.warn(
          `Admin rate preview: provider fetch failed: ${result.reason?.message ?? result.reason}`,
        );
      }
    }

    return this.ensureRatesIncludeAllowedCheckoutTier(rateData);
  }

  /** Returns null when provider is not configured (admin UI should not load it). */
  private async fetchRawRatesForProvider(
    provider: AdminRatePreviewProvider,
    shipment: Awaited<ReturnType<typeof this.loadShipmentForQuote>>,
    quoteWindowStart: Date,
    warnings: ShippingQuoteWarning[],
  ): Promise<any[] | null> {
    if (!this.isAdminRatePreviewProviderAvailable(provider)) {
      return null;
    }
    const pickup = this.asAddress(shipment.pickupAddress);
    const delivery = this.asAddress(shipment.deliveryAddress);
    const leg: ShippingQuoteWarning['leg'] =
      shipment.type === 'RETURN' ? 'return' : 'outbound';
    const packageValueNgn = Math.round(this.estimateOrderValueKobo(shipment) / 100);
    const sourceLine = this.formatAddressLine(pickup);
    const destLine = this.formatAddressLine(delivery);

    let rows: any[] = [];
    switch (provider) {
      case ADMIN_RATE_PREVIEW_TOPSHIP:
        rows = await this.fetchTopshipPartnerRates(
          pickup,
          delivery,
          quoteWindowStart,
          warnings,
          leg,
        );
        break;
      case ADMIN_RATE_PREVIEW_CHOWDECK_RELAY:
        rows = await this.fetchChowdeckRelayRateRows(
          sourceLine,
          destLine,
          this.estimateOrderValueKobo(shipment),
          warnings,
          leg,
        );
        break;
      case ADMIN_RATE_PREVIEW_SHIPBUBBLE:
        rows = await this.fetchShipbubbleRateRows(
          pickup,
          delivery,
          packageValueNgn,
          quoteWindowStart,
          warnings,
          leg,
          shipment.type,
        );
        break;
      case ADMIN_RATE_PREVIEW_TSHIP:
        rows = await this.fetchTshipRateRows(
          pickup,
          delivery,
          packageValueNgn,
          warnings,
          leg,
          shipment.type,
        );
        break;
      default:
        return null;
    }
    return this.ensureRatesIncludeAllowedCheckoutTier(rows);
  }

  private carrierQuoteWarning(
    carrier: 'Topship' | 'Shipbubble' | 'Chowdeck Relay' | 'TShip',
    detail: string,
  ): string {
    const core = detail.trim() || 'Carrier API request failed';
    if (core.toLowerCase().startsWith(`${carrier.toLowerCase()}:`)) {
      return core;
    }
    return `${carrier}: ${core}`;
  }

  private topshipQuoteErrorMessage(err: unknown): string {
    const msg = this.quoteErrorDetail(err);
    if (
      (err as { code?: string })?.code === 'ECONNABORTED' ||
      /timeout/i.test(msg)
    ) {
      const sec = this.topshipService.quoteHttpTimeout() / 1000;
      return this.carrierQuoteWarning(
        'Topship',
        `Carrier API request failed (timed out after ${sec}s)`,
      );
    }
    return this.carrierQuoteWarning('Topship', msg || 'Carrier API request failed');
  }

  private quoteErrorDetail(err: unknown): string {
    if (err && typeof err === 'object') {
      const e = err as {
        message?: string;
        getResponse?: () => unknown;
      };
      if (typeof e.getResponse === 'function') {
        const response = e.getResponse();
        if (typeof response === 'string' && response.trim()) {
          return response.trim();
        }
        if (response && typeof response === 'object') {
          const nested = (response as { message?: unknown }).message;
          if (typeof nested === 'string' && nested.trim()) {
            return nested.trim();
          }
        }
      }
      if (typeof e.message === 'string' && e.message.trim()) {
        return e.message.trim();
      }
    }
    return '';
  }

  /**
   * Topship PickUp: same-day partners from get-pickup-rates (Chowdeck/Glovo).
   * Inter-city get-shipment-rate (Dellyman/Fez) is only used outside Lagos metro.
   */
  private async fetchTopshipPartnerRates(
    pickup: AddressSnapshot,
    delivery: AddressSnapshot,
    quoteWindowStart: Date,
    warnings: ShippingQuoteWarning[],
    leg: ShippingQuoteWarning['leg'],
  ): Promise<any[]> {
    const senderCity = resolveTopshipCityName({
      city: pickup.city != null ? String(pickup.city) : undefined,
      state: pickup.state != null ? String(pickup.state) : undefined,
      street: pickup.street != null ? String(pickup.street) : undefined,
    });
    const receiverCity = resolveTopshipCityName({
      city: delivery.city != null ? String(delivery.city) : undefined,
      state: delivery.state != null ? String(delivery.state) : undefined,
      street: delivery.street != null ? String(delivery.street) : undefined,
    });
    const intraLagos = this.isIntraLagosDelivery(pickup, delivery);
    this.logger.log(
      `Admin rate preview: fetching Topship pickup${intraLagos ? ' (Lagos metro)' : ' + linehaul'} (${senderCity} → ${receiverCity}, leg=${leg})`,
    );

    const pickupPayload = this.buildTopshipPickupRateInput(
      pickup,
      quoteWindowStart,
    );

    let pickupRows: any[] = [];
    let linehaulRows: any[] = [];
    try {
      pickupRows = await this.topshipService
        .getPickupRates(pickupPayload)
        .then((r) => (Array.isArray(r) ? r : []));

      if (!intraLagos) {
        linehaulRows = await this.topshipService
          .getLinehaulShipmentRates({
            senderDetails: { cityName: senderCity, countryCode: 'NG' },
            receiverDetails: { cityName: receiverCity, countryCode: 'NG' },
            totalWeight: 1,
          })
          .then((r) => (Array.isArray(r) ? r : []));
      }
    } catch (err: unknown) {
      warnings.push({
        provider: 'topship',
        message: this.topshipQuoteErrorMessage(err),
        leg,
      });
      return [];
    }

    if (pickupRows.length === 0) {
      warnings.push({
        provider: 'topship',
        message: this.carrierQuoteWarning(
          'Topship',
          'No same-day Chowdeck or Glovo pickup at this address for the selected window.',
        ),
        leg,
      });
      return [];
    }
    if (!intraLagos && linehaulRows.length === 0) {
      warnings.push({
        provider: 'topship',
        message: this.carrierQuoteWarning(
          'Topship',
          'No line-haul rate for this city pair.',
        ),
        leg,
      });
      return [];
    }

    const combined: any[] = [];
    for (const pickupRow of pickupRows) {
      const partner = String(pickupRow?.partner ?? '')
        .trim()
        .toLowerCase();
      if (partner !== 'chowdeck' && partner !== 'glovo') continue;

      const pickupChargeKobo = Math.round(Number(pickupRow.pickupCharge ?? 0));
      const pickupId = String(pickupRow.pickupId ?? '').trim();

      let shipmentChargeKobo = 0;
      let topshipLinehaulTier: string | undefined;
      if (!intraLagos) {
        const linehaul = this.pickTopshipLinehaulRate(linehaulRows, partner);
        if (!linehaul) continue;
        shipmentChargeKobo = Math.round(Number(linehaul.cost ?? 0));
        topshipLinehaulTier = String(linehaul.pricingTier ?? '').trim();
      }

      combined.push({
        pricingTier: partner,
        cost: shipmentChargeKobo,
        pickupCharge: pickupChargeKobo,
        topshipPickupId: pickupId || undefined,
        topshipLinehaulTier,
      });
    }

    if (combined.length === 0) {
      warnings.push({
        provider: 'topship',
        message: this.carrierQuoteWarning(
          'Topship',
          'Could not build partner quotes from pickup and line-haul data.',
        ),
        leg,
      });
    }

    return combined;
  }

  /** Relisted Lagos operations: both legs in Lagos state (e.g. Ikoyi → Ogba). */
  private isIntraLagosDelivery(
    pickup: AddressSnapshot,
    delivery: AddressSnapshot,
  ): boolean {
    const inLagosMetro = (addr: AddressSnapshot) => {
      const state = String(addr.state ?? '')
        .trim()
        .toLowerCase();
      const city = String(addr.city ?? '')
        .trim()
        .toLowerCase();
      return state.includes('lagos') || city.includes('lagos');
    };
    return inLagosMetro(pickup) && inLagosMetro(delivery);
  }

  private buildTopshipPickupRateInput(
    address: AddressSnapshot,
    pickupDate: Date,
  ) {
    return {
      senderDetail: buildTopshipSenderDetail({
        street: address.street != null ? String(address.street) : undefined,
        city: address.city != null ? String(address.city) : undefined,
        state: address.state != null ? String(address.state) : undefined,
      }),
      pickupDate: pickupDate.toISOString(),
    };
  }

  private pickTopshipLinehaulRate(
    shipRows: any[],
    partner: string,
  ): any | null {
    const list = Array.isArray(shipRows) ? shipRows : [];
    if (!list.length) return null;
    const p = partner.trim().toLowerCase();
    const match = list.find(
      (r) =>
        String(r?.pricingTier ?? '')
          .trim()
          .toLowerCase() === p,
    );
    if (match) return match;
    return list.reduce((best, r) => {
      const c = Number(r?.cost ?? Number.MAX_SAFE_INTEGER);
      const bc = Number(best?.cost ?? Number.MAX_SAFE_INTEGER);
      return c < bc ? r : best;
    }, list[0]);
  }

  private async fetchChowdeckRelayRateRows(
    sourceLine: string,
    destLine: string,
    estimatedOrderAmountKobo: number,
    warnings: ShippingQuoteWarning[],
    leg: ShippingQuoteWarning['leg'],
  ): Promise<any[]> {
    if (!chowdeckRelayQuotesAvailable()) return [];
    const src = sourceLine.trim();
    const dst = destLine.trim();
    if (!src || !dst) return [];
    try {
      const q = await this.chowdeckRelayService.getDeliveryFee({
        sourceAddressString: src,
        destinationAddressString: dst,
        estimatedOrderAmountKobo,
      });
      return [
        {
          pricingTier: 'chowdeck_relay',
          name: 'Chowdeck Relay',
          cost: q.totalAmountKobo,
        },
      ];
    } catch (err: any) {
      warnings.push({
        provider: 'chowdeck_relay',
        message: this.carrierQuoteWarning(
          'Chowdeck Relay',
          String(err?.message ?? 'Carrier API request failed'),
        ),
        leg,
      });
      return [];
    }
  }

  private async fetchTshipRateRows(
    sender: AddressSnapshot,
    receiver: AddressSnapshot,
    packageValueNgn: number,
    warnings: ShippingQuoteWarning[],
    leg: ShippingQuoteWarning['leg'],
    shipmentType: ShipmentType,
  ): Promise<any[]> {
    if (!tshipQuotesAvailable()) return [];

    const senderLine = this.formatAddressLine(sender);
    const receiverLine = this.formatAddressLine(receiver);
    if (!senderLine || !receiverLine) return [];

    try {
      const quotes = await this.tshipService.fetchShipmentQuotes(
        {
          pickup: {
            name: sanitizeShipbubbleContactName(
              String(sender.name ?? ''),
              leg === 'return' ? 'Relisted Renter' : 'Relisted Lister',
            ),
            email: String(sender.email ?? 'noreply@relisted.com'),
            phone: sanitizeShipbubblePhone(String(sender.phone ?? '')),
            line1: senderLine,
            street:
              sender.street != null ? String(sender.street as string) : undefined,
            city: String(sender.city ?? 'Lagos'),
            state: String(sender.state ?? 'Lagos'),
            country: String(sender.country ?? 'NG'),
            zip:
              sender.zip != null ? String(sender.zip as string) : undefined,
          },
          delivery: {
            name: sanitizeShipbubbleContactName(
              String(receiver.name ?? ''),
              leg === 'return' ? 'Relisted Lister' : 'Relisted Renter',
            ),
            email: String(receiver.email ?? 'noreply@relisted.com'),
            phone: sanitizeShipbubblePhone(String(receiver.phone ?? '')),
            line1: receiverLine,
            street:
              receiver.street != null
                ? String(receiver.street as string)
                : undefined,
            city: String(receiver.city ?? 'Lagos'),
            state: String(receiver.state ?? 'Lagos'),
            country: String(receiver.country ?? 'NG'),
            zip:
              receiver.zip != null
                ? String(receiver.zip as string)
                : undefined,
          },
          parcel: {
            description: 'Relisted order',
            valueNgn: Math.max(1, Math.round(packageValueNgn)),
            itemName: 'Relisted order',
          },
        },
        { sameDayOnly: shipmentType !== 'RETURN' },
      );

      const byCarrier = new Map<string, (typeof quotes)[number]>();
      for (const q of quotes) {
        const tier = tshipPricingTierSlug(q.carrierSlug);
        const existing = byCarrier.get(tier);
        if (!existing || q.totalNgn < existing.totalNgn) {
          byCarrier.set(tier, q);
        }
      }

      return [...byCarrier.entries()].map(([pricingTier, q]) => ({
        pricingTier,
        name: formatTshipCheckoutTierName(q.carrierName, q.carrierSlug),
        cost: Math.round(q.totalNgn * 100),
        tshipRateId: q.rateId,
        description:
          leg === 'return'
            ? 'Return pickup via TShip (priced for selected window)'
            : q.deliveryTime
              ? `Same-day delivery: ${q.deliveryTime}`
              : 'Same-day courier via TShip',
      }));
    } catch (err: unknown) {
      warnings.push({
        provider: 'tship',
        message: this.carrierQuoteWarning(
          'TShip',
          this.quoteErrorDetail(err) ||
            (err instanceof Error ? err.message : '') ||
            'Carrier API request failed',
        ),
        leg,
      });
      return [];
    }
  }

  private async fetchShipbubbleRateRows(
    sender: AddressSnapshot,
    receiver: AddressSnapshot,
    packageValueNgn: number,
    scheduledWindowStart: Date,
    warnings: ShippingQuoteWarning[],
    leg: ShippingQuoteWarning['leg'],
    shipmentType: ShipmentType,
  ): Promise<any[]> {
    if (!shipbubbleQuotesAvailable()) return [];

    const senderLine = formatShipbubbleAddressLine({
      street: String(sender.street ?? ''),
      city: String(sender.city ?? ''),
      state: String(sender.state ?? ''),
      country: String(sender.country ?? ''),
    });
    const receiverLine = formatShipbubbleAddressLine({
      street: String(receiver.street ?? ''),
      city: String(receiver.city ?? ''),
      state: String(receiver.state ?? ''),
      country: String(receiver.country ?? ''),
    });
    if (!senderLine || !receiverLine) return [];

    try {
      const quotes = await this.shipbubbleService.fetchPickupQuotes(
        {
          sender: {
            name: sanitizeShipbubbleContactName(
              String(sender.name ?? ''),
              leg === 'return' ? 'Relisted Renter' : 'Relisted Lister',
            ),
            email: String(sender.email ?? 'noreply@relisted.com'),
            phone: sanitizeShipbubblePhone(String(sender.phone ?? '')),
            addressLine: senderLine,
          },
          receiver: {
            name: sanitizeShipbubbleContactName(
              String(receiver.name ?? ''),
              leg === 'return' ? 'Relisted Lister' : 'Relisted Renter',
            ),
            email: String(receiver.email ?? 'noreply@relisted.com'),
            phone: sanitizeShipbubblePhone(String(receiver.phone ?? '')),
            addressLine: receiverLine,
          },
          packageItems: this.shipbubbleService.buildDefaultPackageItems([
            {
              name: 'Relisted order',
              valueNgn: Math.max(1, Math.round(packageValueNgn)),
            },
          ]),
          scheduledWindowStart,
        },
        { sameDayOnly: shipmentType !== 'RETURN' },
      );
      const rows = quotes.map((q) => ({
        pricingTier: shipbubblePricingTierSlug(q.serviceCode),
        name: formatShipbubbleCheckoutTierName(q.courierName),
        cost: Math.round(q.totalNgn * 100),
        shipbubbleRequestToken: q.requestToken,
        shipbubbleCourierId: q.courierId,
        shipbubbleServiceCode: q.serviceCode,
        description:
          leg === 'return'
            ? 'Return pickup via Shipbubble (priced for selected window)'
            : 'Same-day courier pickup via Shipbubble',
      }));
      return rows;
    } catch (err: any) {
      warnings.push({
        provider: 'shipbubble',
        message: this.carrierQuoteWarning(
          'Shipbubble',
          String(err?.message ?? 'Carrier API request failed'),
        ),
        leg,
      });
      return [];
    }
  }

  private buildTierCards(
    rateData: any[],
    renterChargedKobo: number,
  ): ShipmentRateTier[] {
    const map = new Map<string, ShipmentRateTier>();
    for (const rate of rateData) {
      if (!rate?.pricingTier) continue;
      const slug = this.slugForCheckoutShippingTier(rate.pricingTier);
      if (!slug) continue;
      const shipmentChargeKobo = Math.round(
        Number(rate.cost ?? RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO),
      );
      const pickupChargeKobo = Math.round(Number(rate.pickupCharge ?? 0));
      const vatChargeKobo =
        slug === 'chowdeck_relay' ||
        isShipbubblePricingTier(rate.pricingTier) ||
        isTshipPricingTier(rate.pricingTier)
          ? 0
          : Math.ceil(shipmentChargeKobo * 0.075);
      const totalCostKobo =
        shipmentChargeKobo + pickupChargeKobo + vatChargeKobo;
      const displayName =
        slug === 'glovo'
          ? 'Glovo (via Topship)'
          : slug === 'chowdeck'
            ? 'Chowdeck (via Topship)'
            : (rate.name && String(rate.name).trim()) ||
              (slug === 'relisted_dispatch'
                ? RELISTED_DISPATCH_SHIPPING_LABEL
                : slug === 'chowdeck_relay'
                  ? 'Chowdeck Relay'
                  : slug.startsWith('shipbubble:')
                    ? formatShipbubbleCheckoutTierName(
                        slug.slice('shipbubble:'.length).replace(/_/g, ' '),
                      )
                    : slug.startsWith('tship:')
                      ? formatTshipCheckoutTierName(
                          slug.slice('tship:'.length).replace(/-/g, ' '),
                        )
                      : 'Chowdeck');
      const existing = map.get(slug);
      if (!existing || totalCostKobo < existing.totalCostKobo) {
        map.set(slug, {
          pricingTier: String(rate.pricingTier),
          name: displayName,
          shipmentChargeKobo,
          pickupChargeKobo,
          vatChargeKobo,
          totalCostKobo,
          deltaKobo: totalCostKobo - renterChargedKobo,
          description:
            rate.description != null
              ? String(rate.description).trim()
              : undefined,
          shipbubbleRequestToken: rate.shipbubbleRequestToken,
          shipbubbleCourierId: rate.shipbubbleCourierId,
          topshipPickupId: rate.topshipPickupId,
          tshipRateId: rate.tshipRateId,
        });
      }
    }
    const preferred = ['chowdeck', 'glovo', 'chowdeck_relay', 'relisted_dispatch'];
    return [...map.entries()]
      .sort(([a], [b]) => {
        const sortBucket = (slug: string) => {
          if (slug.startsWith('tship:')) return 2;
          if (slug.startsWith('shipbubble')) return 3;
          return preferred.indexOf(slug);
        };
        const ai = sortBucket(a);
        const bi = sortBucket(b);
        const ar = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
        const br = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
        if (ar !== br) return ar - br;
        return (
          (map.get(a)?.totalCostKobo ?? 0) - (map.get(b)?.totalCostKobo ?? 0)
        );
      })
      .map(([, tier]) => tier);
  }

  private slugForCheckoutShippingTier(pricingTier: string | undefined): string | null {
    const t = String(pricingTier ?? '').trim().toLowerCase();
    if (t === 'glovo') return 'glovo';
    if (t === 'chowdeck') return 'chowdeck';
    if (t === 'chowdeck_relay') return 'chowdeck_relay';
    if (t.startsWith('shipbubble:')) return t;
    if (t === 'shipbubble') return 'shipbubble';
    if (t.startsWith('tship:')) return t;
    if (t === 'tship') return 'tship';
    if (t === RELISTED_DISPATCH_SHIPPING_LABEL.toLowerCase()) {
      return 'relisted_dispatch';
    }
    return null;
  }

  private hasThirdPartyCheckoutShippingRates(rates: any[]): boolean {
    return rates.some((r) => {
      const slug = this.slugForCheckoutShippingTier(r?.pricingTier);
      return Boolean(slug && slug !== 'relisted_dispatch');
    });
  }

  private ensureRatesIncludeAllowedCheckoutTier(rates: any[]): any[] {
    const list = Array.isArray(rates) ? rates : [];
    const hasThirdParty = this.hasThirdPartyCheckoutShippingRates(list);
    const filtered = list.filter((r) => {
      const slug = this.slugForCheckoutShippingTier(r?.pricingTier);
      if (!slug) return false;
      if (slug === 'relisted_dispatch' && hasThirdParty) return false;
      return true;
    });
    if (filtered.length > 0) return filtered;
    return [
      {
        pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL,
        name: RELISTED_DISPATCH_SHIPPING_LABEL,
        cost: RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO,
      },
    ];
  }

  private normalizeTopshipTier(tier: string | null | undefined): string {
    const t = String(tier ?? '').trim().toLowerCase();
    if (!t) return 'chowdeck';
    if (t === 'chowdeck_relay') return 'chowdeck_relay';
    if (isShipbubblePricingTier(t)) return t;
    if (isTshipPricingTier(t)) return t;
    if (t === 'glovo') return 'glovo';
    return 'chowdeck';
  }
}
