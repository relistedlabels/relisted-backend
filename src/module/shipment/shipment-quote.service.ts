import { Injectable, NotFoundException } from '@nestjs/common';
import { Shipment, ShipmentType } from '@prisma/client';
import {
  chowdeckRelayQuotesAvailable,
  shipbubbleQuotesAvailable,
  topshipFulfillmentEnabled,
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
};

export type ShipmentRatePreviewData = {
  tiers: ShipmentRateTier[];
  warnings: ShippingQuoteWarning[];
  renterChargedKobo: number;
  quoteWindowStart: string;
  storedWindowStart: string | null;
  forImmediate: boolean;
};

type AddressSnapshot = Record<string, unknown>;

@Injectable()
export class ShipmentQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topshipService: TopshipService,
    private readonly chowdeckRelayService: ChowdeckRelayService,
    private readonly shipbubbleService: ShipbubbleService,
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

    let rateData: any[] = [];
    if (topshipFulfillmentEnabled()) {
      const senderCity = String(pickup.city ?? 'Lagos').trim() || 'Lagos';
      const receiverCity = String(delivery.city ?? 'Lagos').trim() || 'Lagos';
      try {
        const rows = await this.topshipService.getShipmentRate({
          senderDetails: { cityName: senderCity, countryCode: 'NG' },
          receiverDetails: { cityName: receiverCity, countryCode: 'NG' },
          totalWeight: 1,
        });
        rateData = Array.isArray(rows) ? rows : [];
      } catch (err: any) {
        warnings.push({
          provider: 'topship',
          message: String(err?.message ?? 'Topship quote unavailable'),
          leg,
        });
      }
    }

    const sourceLine = this.formatAddressLine(pickup);
    const destLine = this.formatAddressLine(delivery);
    rateData = await this.maybeAppendChowdeckRelayRate(
      rateData,
      sourceLine,
      destLine,
      this.estimateOrderValueKobo(shipment),
      warnings,
      leg,
    );
    rateData = await this.maybeAppendShipbubbleRate(
      rateData,
      pickup,
      delivery,
      packageValueNgn,
      quoteWindowStart,
      warnings,
      leg,
      shipment.type,
    );

    return this.ensureRatesIncludeAllowedCheckoutTier(rateData);
  }

  private async maybeAppendChowdeckRelayRate(
    rateData: any[],
    sourceLine: string,
    destLine: string,
    estimatedOrderAmountKobo: number,
    warnings: ShippingQuoteWarning[],
    leg: ShippingQuoteWarning['leg'],
  ): Promise<any[]> {
    if (!chowdeckRelayQuotesAvailable()) return rateData;
    const src = sourceLine.trim();
    const dst = destLine.trim();
    if (!src || !dst) return rateData;
    try {
      const q = await this.chowdeckRelayService.getDeliveryFee({
        sourceAddressString: src,
        destinationAddressString: dst,
        estimatedOrderAmountKobo,
      });
      return [
        ...(Array.isArray(rateData) ? rateData : []),
        {
          pricingTier: 'chowdeck_relay',
          name: 'Chowdeck Relay',
          cost: q.totalAmountKobo,
        },
      ];
    } catch (err: any) {
      warnings.push({
        provider: 'chowdeck_relay',
        message: String(err?.message ?? 'Chowdeck Relay quote unavailable'),
        leg,
      });
      return rateData;
    }
  }

  private async maybeAppendShipbubbleRate(
    rateData: any[],
    sender: AddressSnapshot,
    receiver: AddressSnapshot,
    packageValueNgn: number,
    scheduledWindowStart: Date,
    warnings: ShippingQuoteWarning[],
    leg: ShippingQuoteWarning['leg'],
    shipmentType: ShipmentType,
  ): Promise<any[]> {
    if (!shipbubbleQuotesAvailable()) return rateData;

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
    if (!senderLine || !receiverLine) return rateData;

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
      return [...(Array.isArray(rateData) ? rateData : []), ...rows];
    } catch (err: any) {
      warnings.push({
        provider: 'shipbubble',
        message: String(err?.message ?? 'Shipbubble quote unavailable'),
        leg,
      });
      return rateData;
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
      const pickupChargeKobo = 0;
      const vatChargeKobo =
        slug === 'chowdeck_relay' || isShipbubblePricingTier(rate.pricingTier)
          ? 0
          : Math.ceil(shipmentChargeKobo * 0.075);
      const totalCostKobo =
        shipmentChargeKobo + pickupChargeKobo + vatChargeKobo;
      const displayName =
        (rate.name && String(rate.name).trim()) ||
        (slug === 'glovo'
          ? 'Glovo'
          : slug === 'relisted_dispatch'
            ? RELISTED_DISPATCH_SHIPPING_LABEL
            : slug === 'chowdeck_relay'
              ? 'Chowdeck Relay'
              : slug.startsWith('shipbubble:')
                ? formatShipbubbleCheckoutTierName(
                    slug.slice('shipbubble:'.length).replace(/_/g, ' '),
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
            rate.description != null ? String(rate.description).trim() : undefined,
          shipbubbleRequestToken: rate.shipbubbleRequestToken,
          shipbubbleCourierId: rate.shipbubbleCourierId,
        });
      }
    }
    const preferred = ['chowdeck', 'glovo', 'chowdeck_relay', 'relisted_dispatch'];
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ai = a.startsWith('shipbubble') ? 3 : preferred.indexOf(a);
        const bi = b.startsWith('shipbubble') ? 3 : preferred.indexOf(b);
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
    if (t === 'glovo') return 'glovo';
    return 'chowdeck';
  }
}
