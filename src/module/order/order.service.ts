import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, Prisma } from '@prisma/client';
import { Order_Verification } from 'src/services/event/event.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipService } from 'src/services/topship/topship.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import { addDays, addMinutes, startOfDay } from 'date-fns';
import { NotificationService } from 'src/services/notification/notification.service';
import { DEFAULT_CLEANING_FEE_NGN } from 'src/constants/rental-pricing';
import {
  CreateOrderDto,
  ReturnPickupAddressDto,
} from './dto/create-order.dto';
import {
  DispatchWindowRange,
  DispatchWindowRangeMap,
  DispatchWindowType,
  DispatchWindowsInput,
  buildDefaultDispatchWindow,
  isWindowExpired,
  parseDispatchWindowFromInput,
} from 'src/utils/dispatch-windows';
import {
  isRelistedDispatchShippingTier,
  RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO,
  RELISTED_DISPATCH_SHIPPING_LABEL,
} from 'src/constants/relisted-dispatch-shipping';
import { fetchAdminAlertRecipients } from 'src/module/shipment/shipment-admin-alert-recipients';
import { buildAdminShipmentsPageUrl } from 'src/module/shipment/build-admin-shipments-page-url';
import { MailService } from 'src/services/mail/mail.service';

const IMMEDIATE_DISPATCH_THRESHOLD_MINUTES = Number(
  process.env.IMMEDIATE_DISPATCH_THRESHOLD_MINUTES ?? 60,
);

/**
 * Dedupes identical Topship quote calls within one GET /order/summary (shared lister
 * legs, same renter return address, same city pairs). Cuts duplicate HTTP when cart
 * splits into multiple buckets for the same curator.
 */
function createCheckoutSummaryTopshipMemo(topship: TopshipService) {
  const pickups = new Map<string, Promise<any[]>>();
  const ships = new Map<string, Promise<any[]>>();

  const pickupPayloadKey = (payload: {
    senderDetail: Record<string, unknown>;
    pickupDate?: string;
  }) =>
    JSON.stringify({
      street: payload.senderDetail?.addressLine1,
      city: payload.senderDetail?.city,
      state: payload.senderDetail?.state,
      country: payload.senderDetail?.country,
      countryCode: payload.senderDetail?.countryCode,
      day:
        typeof payload.pickupDate === 'string'
          ? payload.pickupDate.slice(0, 10)
          : '',
    });

  const shipPayloadKey = (payload: unknown) => JSON.stringify(payload);

  async function pickupRates(payload: any): Promise<any[]> {
    const k = pickupPayloadKey(payload);
    let pr = pickups.get(k);
    if (!pr) {
      const city = String(payload?.senderDetail?.city ?? '?');
      pr = topship
        .getPickupRates(payload)
        .then((r) => (Array.isArray(r) ? r : []))
        .catch((err: any) => {
          console.warn(
            `Pickup calculation failed for ${city}. Reason:`,
            err?.message ?? err,
          );
          return [];
        });
      pickups.set(k, pr);
    }
    return pr;
  }

  async function shipRates(payload: any): Promise<any[]> {
    const k = shipPayloadKey(payload);
    let sr = ships.get(k);
    if (!sr) {
      const from = String(payload?.senderDetails?.cityName ?? '?');
      const to = String(payload?.receiverDetails?.cityName ?? '?');
      sr = topship
        .getShipmentRate(payload)
        .then((r) => (Array.isArray(r) ? r : []))
        .catch((err: any) => {
          console.warn(
            `Shipping calculation failed between ${from} and ${to}. Reason:`,
            err?.message ?? err,
          );
          return [];
        });
      ships.set(k, sr);
    }
    return sr;
  }

  return { pickupRates, shipRates };
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private topshipService: TopshipService,
    private notificationService: NotificationService,
    private readonly mailService: MailService,
    @InjectQueue('shipment-dispatch')
    private readonly shipmentDispatchQueue: Queue,
  ) {}

  private async cartItemsApprovedForCheckout(
    requesterId: string,
    items: any[],
  ): Promise<any[]> {
    const ids = items.map((i) => i.id);
    if (ids.length === 0) return [];
    const accepted = await this.prisma.availabilityRequest.findMany({
      where: {
        requesterId,
        cartItemId: { in: ids },
        status: 'ACCEPTED',
      },
      select: {
        id: true,
        cartItemId: true,
        startDate: true,
        endDate: true,
        outboundWindowStart: true,
        outboundWindowEnd: true,
        returnWindowStart: true,
        returnWindowEnd: true,
        resaleWindowStart: true,
        resaleWindowEnd: true,
      },
    });
    const acceptedMap = new Map(accepted.map((r) => [r.cartItemId, r]));
    const now = new Date();
    const enriched: any[] = [];

    for (const item of items) {
      const request = acceptedMap.get(item.id);
      if (!request) continue;
      const dispatchWindows = this.buildDispatchWindowRangeMap(request);
      await this.ensureAvailabilityRequestWindowActive(
        item,
        request,
        dispatchWindows,
        now,
      );
      enriched.push({
        ...item,
        startDate: request.startDate,
        endDate: request.endDate,
        dispatchWindows,
      });
    }

    return enriched;
  }

  private buildDispatchWindowRangeMap(request: any): DispatchWindowRangeMap {
    const map: DispatchWindowRangeMap = {};
    const assign = (
      type: DispatchWindowType,
      start?: Date | null,
      end?: Date | null,
    ) => {
      if (start && end) {
        map[type] = {
          start: new Date(start),
          end: new Date(end),
        };
      }
    };

    assign('OUTBOUND', request.outboundWindowStart, request.outboundWindowEnd);
    assign('RETURN', request.returnWindowStart, request.returnWindowEnd);
    assign('RESALE', request.resaleWindowStart, request.resaleWindowEnd);

    return map;
  }

  private async ensureAvailabilityRequestWindowActive(
    item: any,
    request: any,
    dispatchWindows: DispatchWindowRangeMap,
    now: Date,
  ) {
    const listingType = item.product?.listingType;
    const isRentalItem =
      item.days > 0 &&
      (listingType === 'RENTAL' || listingType === 'RENT_OR_RESALE');
    const isResaleItem =
      item.days === 0 &&
      (listingType === 'RESALE' || listingType === 'RENT_OR_RESALE');

    const required: DispatchWindowType[] = [];
    if (isRentalItem) {
      required.push('OUTBOUND', 'RETURN');
    }
    if (isResaleItem) {
      required.push('RESALE');
    }

    for (const type of required) {
      const window = dispatchWindows[type];
      if (!window || isWindowExpired(window, now)) {
        await this.prisma.availabilityRequest.update({
          where: { id: request.id },
          data: { status: 'EXPIRED' },
        });
        bad(
          `The approved ${type.toLowerCase()} dispatch window for ${
            item.product?.name || 'this item'
          } has expired. Please submit a new availability request.`,
        );
      }
    }
  }

  /** Lagos-formatted range for lister order confirmation emails (matches checkout copy style). */
  private formatDispatchWindowRangeForEmailLagos(start: Date, end: Date): string {
    const tz = 'Africa/Lagos';
    const sameCalendarDay =
      start.toLocaleDateString('en-CA', { timeZone: tz }) ===
      end.toLocaleDateString('en-CA', { timeZone: tz });
    if (sameCalendarDay) {
      const dateLine = start.toLocaleDateString('en-NG', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const startTime = start.toLocaleTimeString('en-NG', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const endTime = end.toLocaleTimeString('en-NG', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${dateLine}, ${startTime} to ${endTime}`;
    }
    const fmtFull = (d: Date) =>
      d.toLocaleString('en-NG', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    return `${fmtFull(start)} to ${fmtFull(end)}`;
  }

  private resolveDispatchWindow(
    type: DispatchWindowType,
    fallbackStart: Date,
    dispatchWindows?: DispatchWindowsInput,
    requestedWindow?: DispatchWindowRange,
  ) {
    if (requestedWindow) {
      return requestedWindow;
    }

    const manual = dispatchWindows?.[type];
    if (manual?.start && manual?.end) {
      return parseDispatchWindowFromInput(type, manual);
    }

    return buildDefaultDispatchWindow(fallbackStart);
  }

  private shouldDispatchImmediately(
    windowStart: Date | null | undefined,
    now = new Date(),
  ) {
    if (!windowStart) return false;
    const threshold = addMinutes(now, IMMEDIATE_DISPATCH_THRESHOLD_MINUTES);
    return windowStart.getTime() <= threshold.getTime();
  }

  /** Tier slug stored on Shipment (lowercase); TopshipService maps to GraphQL enum (e.g. Chowdeck). */
  private normalizeTopshipTier(tier: string | null | undefined): string {
    const t = String(tier ?? '')
      .trim()
      .toLowerCase();
    if (!t || t === 'budget' || t === 'standard') return 'chowdeck';
    if (t === RELISTED_DISPATCH_SHIPPING_LABEL.toLowerCase())
      return 'chowdeck';
    return t;
  }

  /** Group cart lines into shipment buckets (same lister, same resolved dispatch windows). */
  private buildShipmentBucketsForLister(
    items: any[],
    dispatchWindowsInput?: DispatchWindowsInput,
  ): Array<{
    bucketMode: 'RENTAL' | 'RESALE';
    items: any[];
    outboundWindow: { start: Date; end: Date } | null;
    returnWindow: { start: Date; end: Date } | null;
    resaleWindow: { start: Date; end: Date } | null;
  }> {
    const rentalItems = items.filter(
      (it) =>
        it.days > 0 &&
        (it.product.listingType === 'RENTAL' ||
          it.product.listingType === 'RENT_OR_RESALE'),
    );
    const resaleItems = items.filter(
      (it) =>
        it.product.listingType === 'RESALE' ||
        (it.product.listingType === 'RENT_OR_RESALE' && it.days === 0),
    );

    const rentalGroups = new Map<string, any[]>();
    for (const it of rentalItems) {
      const rentalStart = it.startDate ? new Date(it.startDate) : new Date();
      const rentalEnd = it.endDate
        ? new Date(it.endDate)
        : addDays(rentalStart, it.days ?? 1);
      const ob = this.resolveDispatchWindow(
        'OUTBOUND',
        rentalStart,
        dispatchWindowsInput,
        it.dispatchWindows?.OUTBOUND,
      );
      const ret = this.resolveDispatchWindow(
        'RETURN',
        rentalEnd,
        dispatchWindowsInput,
        it.dispatchWindows?.RETURN,
      );
      const key = `${ob.start.toISOString()}::${ob.end.toISOString()}::${ret.start.toISOString()}::${ret.end.toISOString()}`;
      if (!rentalGroups.has(key)) rentalGroups.set(key, []);
      rentalGroups.get(key)!.push(it);
    }

    const resaleGroups = new Map<string, any[]>();
    for (const it of resaleItems) {
      const rw = this.resolveDispatchWindow(
        'RESALE',
        new Date(),
        dispatchWindowsInput,
        it.dispatchWindows?.RESALE,
      );
      const key = `${rw.start.toISOString()}::${rw.end.toISOString()}`;
      if (!resaleGroups.has(key)) resaleGroups.set(key, []);
      resaleGroups.get(key)!.push(it);
    }

    const out: Array<{
      bucketMode: 'RENTAL' | 'RESALE';
      items: any[];
      outboundWindow: { start: Date; end: Date } | null;
      returnWindow: { start: Date; end: Date } | null;
      resaleWindow: { start: Date; end: Date } | null;
    }> = [];
    const rentalBucketIndexByOutboundKey = new Map<string, number>();

    for (const [, bucketItems] of rentalGroups) {
      const sample = bucketItems[0];
      const rentalStart = sample.startDate
        ? new Date(sample.startDate)
        : new Date();
      const rentalEnd = sample.endDate
        ? new Date(sample.endDate)
        : addDays(rentalStart, sample.days ?? 1);
      const outboundWindow = this.resolveDispatchWindow(
        'OUTBOUND',
        rentalStart,
        dispatchWindowsInput,
        sample.dispatchWindows?.OUTBOUND,
      );
      const returnWindow = this.resolveDispatchWindow(
        'RETURN',
        rentalEnd,
        dispatchWindowsInput,
        sample.dispatchWindows?.RETURN,
      );
      out.push({
        bucketMode: 'RENTAL',
        items: bucketItems,
        outboundWindow,
        returnWindow,
        resaleWindow: null,
      });
      const outboundKey = `${outboundWindow.start.toISOString()}::${outboundWindow.end.toISOString()}`;
      rentalBucketIndexByOutboundKey.set(outboundKey, out.length - 1);
    }

    for (const [, bucketItems] of resaleGroups) {
      const sample = bucketItems[0];
      const resaleWindow = this.resolveDispatchWindow(
        'RESALE',
        new Date(),
        dispatchWindowsInput,
        sample.dispatchWindows?.RESALE,
      );
      const resaleKey = `${resaleWindow.start.toISOString()}::${resaleWindow.end.toISOString()}`;
      const rentalBucketIndex =
        rentalBucketIndexByOutboundKey.get(resaleKey) ?? -1;
      if (rentalBucketIndex >= 0) {
        // Same lister + same outbound window: share one outbound shipment.
        out[rentalBucketIndex].items.push(...bucketItems);
        continue;
      }
      out.push({
        bucketMode: 'RESALE',
        items: bucketItems,
        outboundWindow: null,
        returnWindow: null,
        resaleWindow,
      });
    }

    return out;
  }

  /**
   * Persist Shipment rows for cron / immediate dispatch.
   * Rental bucket: OUTBOUND + RETURN. Resale-only bucket: RESALE.
   */
  private async createCheckoutShipments(
    tx: any,
    orderId: string,
    ld: any,
    renterSnapshot: Record<string, any>,
  ): Promise<
    Array<{
      id: string;
      type: 'OUTBOUND' | 'RETURN' | 'RESALE';
      immediate: boolean;
      manualFulfillment: boolean;
    }>
  > {
    const curator = ld.items[0]?.product?.curator;
    if (!curator) return [];

    const listerAddr =
      curator.profile?.address || curator.profile?.businessInfo;
    const listerJson = {
      name: curator.name || 'Lister',
      phone: curator.profile?.phoneNumber || '08000000000',
      email: curator.email || 'lister@relisted.com',
      street: listerAddr?.street || 'Lagos',
      city: listerAddr?.city || 'Lagos',
      state: listerAddr?.state || 'Lagos',
      country: listerAddr?.country || 'Nigeria',
      zip: listerAddr?.zipCode ?? null,
    };

    const tier = this.normalizeTopshipTier(ld.usedPricingTier);
    const manualFulfillment = isRelistedDispatchShippingTier(ld.usedPricingTier);
    const out: Array<{
      id: string;
      type: 'OUTBOUND' | 'RETURN' | 'RESALE';
      immediate: boolean;
      manualFulfillment: boolean;
    }> = [];

    const hasRental = ld.bucketMode === 'RENTAL';
    const hasResaleOnly = ld.bucketMode === 'RESALE';

    if (hasRental && ld.outboundWindow?.start && ld.outboundWindow?.end) {
      const s = await tx.shipment.create({
        data: {
          orderId,
          listerId: ld.listerId,
          type: 'OUTBOUND',
          status: 'PENDING',
          scheduledDate: startOfDay(ld.outboundWindow.start),
          scheduledWindowStart: ld.outboundWindow.start,
          scheduledWindowEnd: ld.outboundWindow.end,
          pickupAddress: listerJson,
          deliveryAddress: renterSnapshot,
          pricingTier: tier,
          shipmentCharge: ld.shipmentChargeRaw,
          pickupCharge: ld.pickupChargeRaw,
          vatCharge: ld.shipmentVatChargeRaw,
          pickupPartner: ld.pickupPartner,
          pickupId: ld.pickupId || undefined,
          deliveryLocation: ld.deliveryLocation || undefined,
          manualFulfillment,
        },
      });
      out.push({
        id: s.id,
        type: 'OUTBOUND',
        immediate: this.shouldDispatchImmediately(ld.outboundWindow.start),
        manualFulfillment,
      });
    }

    if (hasRental && ld.returnWindow?.start && ld.returnWindow?.end) {
      const s = await tx.shipment.create({
        data: {
          orderId,
          listerId: ld.listerId,
          type: 'RETURN',
          status: 'PENDING',
          scheduledDate: startOfDay(ld.returnWindow.start),
          scheduledWindowStart: ld.returnWindow.start,
          scheduledWindowEnd: ld.returnWindow.end,
          pickupAddress: renterSnapshot,
          deliveryAddress: listerJson,
          pricingTier: tier,
          shipmentCharge: ld.returnShipmentChargeRaw,
          pickupCharge: ld.returnPickupChargeRaw,
          vatCharge: ld.returnShipmentVatChargeRaw,
          pickupPartner: ld.returnPickupPartner,
          pickupId: ld.returnPickupId || undefined,
          deliveryLocation: ld.returnDeliveryLocation || undefined,
          manualFulfillment,
        },
      });
      out.push({
        id: s.id,
        type: 'RETURN',
        immediate: this.shouldDispatchImmediately(ld.returnWindow.start),
        manualFulfillment,
      });
    }

    if (hasResaleOnly && ld.resaleWindow?.start && ld.resaleWindow?.end) {
      const s = await tx.shipment.create({
        data: {
          orderId,
          listerId: ld.listerId,
          type: 'RESALE',
          status: 'PENDING',
          scheduledDate: startOfDay(ld.resaleWindow.start),
          scheduledWindowStart: ld.resaleWindow.start,
          scheduledWindowEnd: ld.resaleWindow.end,
          pickupAddress: listerJson,
          deliveryAddress: renterSnapshot,
          pricingTier: tier,
          shipmentCharge: ld.shipmentChargeRaw,
          pickupCharge: ld.pickupChargeRaw,
          vatCharge: ld.shipmentVatChargeRaw,
          pickupPartner: ld.pickupPartner,
          pickupId: ld.pickupId || undefined,
          deliveryLocation: ld.deliveryLocation || undefined,
          manualFulfillment,
        },
      });
      out.push({
        id: s.id,
        type: 'RESALE',
        immediate: this.shouldDispatchImmediately(ld.resaleWindow.start),
        manualFulfillment,
      });
    }

    return out;
  }

  /** In-app + email for admins when checkout used Relisted dispatch (no Topship auto-booking). */
  private async notifyAdminsManualFulfillmentCheckout(
    humanOrderId: string,
    shipmentIds: string[],
  ) {
    const admins = await fetchAdminAlertRecipients(this.prisma);
    if (admins.length === 0) {
      console.warn(
        `[OrderService] No admin recipients for manual fulfillment alert (order ${humanOrderId}).`,
      );
      return;
    }

    const count = shipmentIds.length;
    const summary =
      count === 1
        ? `Shipment ${shipmentIds[0]}`
        : `${count} shipments (${shipmentIds.slice(0, 3).join(', ')}${count > 3 ? ', …' : ''})`;

    for (const admin of admins) {
      await this.notificationService.createNotification({
        userId: admin.id,
        title: 'Manual dispatch required',
        message: `Order ${humanOrderId}: ${summary} used ${RELISTED_DISPATCH_SHIPPING_LABEL}. Book a rider or carrier in admin, then mark the shipment as dispatched.`,
        type: 'MANUAL_FULFILLMENT_SHIPMENT',
        metadata: {
          orderId: humanOrderId,
          shipmentIds,
        },
      });
    }

    for (const admin of admins) {
      if (!admin.email?.trim()) continue;
      for (const shipmentId of shipmentIds) {
        const adminShipmentUrl =
          buildAdminShipmentsPageUrl({ shipmentId }) || '';
        try {
          await this.mailService.sendAdminManualFulfillmentShipmentAlert({
            to: admin.email.trim(),
            humanOrderId,
            shipmentId,
            adminShipmentUrl,
          });
        } catch (mailErr: any) {
          console.warn(
            `[OrderService] Manual fulfillment email to ${admin.email} failed:`,
            mailErr?.message ?? mailErr,
          );
        }
      }
    }
  }

  private buildRenterDeliveryAddressSnapshot(
    user: userEntity,
    renterProfile: any,
  ) {
    const address = renterProfile.address;
    return {
      name: user.name || 'Renter',
      phone: renterProfile.phoneNumber || '08000000000',
      email: user.email || 'renter@relisted.com',
      street: address?.street || 'Lagos, Nigeria',
      city: address?.city || 'Lagos',
      state: address?.state || 'Lagos',
      country: address?.country || 'Nigeria',
      zip: address?.zipCode ?? null,
    };
  }

  /** Single-line address for admin / shipment snapshot (not Topship pickup-hub fields). */
  private formatAddressSnapshotLine(snapshot: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
  } | null | undefined): string {
    if (!snapshot) return '';
    return [snapshot.street, snapshot.city, snapshot.state]
      .map((p) => (p != null ? String(p).trim() : ''))
      .filter(Boolean)
      .join(', ');
  }

  private buildReturnPickupAddressSnapshot(
    baseSnapshot: Record<string, any>,
    renterProfile: any,
    override?: ReturnPickupAddressDto,
  ) {
    const address = renterProfile.address;
    return {
      ...baseSnapshot,
      street: override?.street || address?.street || baseSnapshot.street,
      city: override?.city || address?.city || baseSnapshot.city,
      state: override?.state || address?.state || baseSnapshot.state,
      country: override?.country || address?.country || baseSnapshot.country,
      zip:
        override?.postalCode ??
        address?.zipCode ??
        baseSnapshot.zip ??
        null,
      landmark: override?.landmark ?? baseSnapshot.landmark,
      instructions: override?.instructions ?? baseSnapshot.instructions,
    };
  }

  private findRateByTier(rates: any[] | undefined, tier?: string) {
    if (!tier || !Array.isArray(rates)) return null;
    const normalizedTier = tier.trim().toLowerCase();
    return (
      rates.find((rate) => {
        const pt = String(rate?.pricingTier ?? '').trim().toLowerCase();
        const nm = String(rate?.name ?? '').trim().toLowerCase();
        return pt === normalizedTier || nm === normalizedTier;
      }) || null
    );
  }

  async getCheckoutSummary(
    user: userEntity,
    returnPickupAddressOverride?: Partial<ReturnPickupAddressDto>,
  ) {
    if (
      process.env.NODE_ENV !== 'production' &&
      returnPickupAddressOverride
    ) {
      console.log(
        '[CheckoutSummary] Return pickup address override:',
        JSON.stringify(returnPickupAddressOverride),
      );
    }

    const [renterProfile, cart] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { userId: user.id },
        include: { address: true },
      }),
      this.prisma.cart.findUnique({
        where: { userId: user.id },
        include: {
          items: {
            include: {
              product: {
                include: {
                  curator: {
                    include: {
                      profile: {
                        include: { address: true, businessInfo: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    if (!renterProfile?.address) {
      bad('Please add a delivery address to your profile before checkout.');
    }

    const renterDeliveryAddressSnapshot =
      this.buildRenterDeliveryAddressSnapshot(user, renterProfile);
    const returnPickupAddressSnapshot =
      this.buildReturnPickupAddressSnapshot(
        renterDeliveryAddressSnapshot,
        renterProfile,
        returnPickupAddressOverride,
      );

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        '[CheckoutSummary] Final return pickup address:',
        JSON.stringify(returnPickupAddressSnapshot),
      );
    }

    if (!cart || cart.items.length === 0) {
      bad('Cart is empty');
    }

    const eligibleItems = await this.cartItemsApprovedForCheckout(
      user.id,
      cart.items,
    );
    if (eligibleItems.length === 0) {
      bad(
        'No items are approved for checkout yet. Wait for lister approval before viewing the payment summary.',
      );
    }

    const itemsByLister = new Map<string, any[]>();
    for (const item of eligibleItems) {
      const listerId = item.product.curatorId;
      if (!itemsByLister.has(listerId)) {
        itemsByLister.set(listerId, []);
      }
      itemsByLister.get(listerId)!.push(item);
    }

    let globalRentalTotal = 0;
    let globalCollateralTotal = 0;
    let globalCleaningTotal = 0;
    let globalPickupTotal = 0;
    let globalOutboundShippingTotal = 0;
    let globalReturnShippingTotal = 0;
    let globalOutboundPickupTotal = 0;
    let globalReturnPickupTotal = 0;
    let globalVatTotal = 0;
    let globalServiceChargeTotal = 0;
    let globalPurchaseTotal = 0;
    const listerBreakdowns: any[] = [];
    const shippingTiersMap = new Map<
      string,
      { name: string; totalShippingCost: number }
    >();

    // Calculate item totals for each lister first (without external API calls)
    const listerData: any[] = [];
    for (const [listerId, items] of itemsByLister.entries()) {
      let listerRentalTotal = 0;
      let listerCollateralTotal = 0;
      let listerCleaningTotal = 0;
      let listerVatTotal = 0;
      let listerServiceChargeTotal = 0;
      let listerPurchaseTotal = 0;
      let curatorAddress: any = null;
      const hasRentalItems = items.some(
        (item) =>
          item.days > 0 &&
          (item.product.listingType === 'RENTAL' ||
            item.product.listingType === 'RENT_OR_RESALE'),
      );

      for (const item of items) {
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (!item.product.productVerified)
          bad(`${item.product.name} is not verified by admin`);
        if (item.product.status === 'SOLD')
          bad(`${item.product.name} is already sold`);

        // Determine if this item is a resale purchase
        const isResalePurchase =
          item.product.listingType === 'RESALE' ||
          (item.product.listingType === 'RENT_OR_RESALE' && item.days === 0);

        // Validate rental duration only for rental items
        if (!isResalePurchase && item.days <= 0) {
          bad('Invalid rental duration');
        }

        curatorAddress =
          item.product.curator.profile?.address ||
          item.product.curator.profile?.businessInfo;

        let rentalAmount = 0;
        let collateralAmount = 0;
        let cleaningFee = 0;
        let vatAmount = 0;
        let serviceCharge = 0;

        if (isResalePurchase) {
          // Resale calculation
          if (!item.product.resalePrice || item.product.resalePrice <= 0) {
            bad(
              `${item.product.name} has invalid resale price for RESALE listing`,
            );
          }
          rentalAmount = 0;
          collateralAmount = 0;
          cleaningFee = 0;
          vatAmount = Math.round(item.product.resalePrice * 0.075);
          serviceCharge = Math.round(item.product.resalePrice * 0.1);
          listerPurchaseTotal += item.product.resalePrice;
          listerRentalTotal += 0; // No rental fee for resale
        } else {
          // Rental calculation
          if (!item.product.dailyPrice) {
            bad(`${item.product.name} is missing daily price for rental`);
          }
          rentalAmount = item.product.dailyPrice * item.days;
          collateralAmount =
            Number(
              item.product.collateralPrice || item.product.originalValue,
            ) || 0;
          cleaningFee = DEFAULT_CLEANING_FEE_NGN;
          vatAmount = Math.round(rentalAmount * 0.075);
          serviceCharge = Math.round(rentalAmount * 0.1);
          listerRentalTotal += rentalAmount;
        }

        listerCollateralTotal += collateralAmount;
        listerCleaningTotal += cleaningFee;
        listerVatTotal += vatAmount;
        listerServiceChargeTotal += serviceCharge;
      }

      listerData.push({
        listerId,
        items,
        listerRentalTotal,
        listerCollateralTotal,
        listerCleaningTotal,
        listerVatTotal,
        listerServiceChargeTotal,
        listerPurchaseTotal,
        curatorAddress,
        hasRentalItems,
      });
    }

    const preferredTierOrderSummary = ['chowdeck', 'glovo'];
    const pickPreferredRateSummary = (rates: any[]) => {
      const list = Array.isArray(rates) ? rates : [];
      for (const name of preferredTierOrderSummary) {
        const found = list.find(
          (r) =>
            String(r?.pricingTier ?? '')
              .trim()
              .toLowerCase() === name,
        );
        if (found) return found;
      }
      return (
        list
          .slice()
          .sort((a, b) => Number(a?.cost ?? 0) - Number(b?.cost ?? 0))[0] ||
        null
      );
    };

    type CheckoutBucketCtx = {
      listerId: string;
      listerName: string;
      curatorAddress: any;
      bucketMode: 'RENTAL' | 'RESALE';
      items: any[];
      outboundWindow: { start: Date; end: Date } | null;
      returnWindow: { start: Date; end: Date } | null;
      resaleWindow: { start: Date; end: Date } | null;
    };

    const bucketContexts: CheckoutBucketCtx[] = [];
    for (const ld of listerData) {
      const buckets = this.buildShipmentBucketsForLister(ld.items, undefined);
      for (const b of buckets) {
        bucketContexts.push({
          listerId: ld.listerId,
          listerName: ld.items[0]?.product?.curator?.name || 'Unknown',
          curatorAddress: ld.curatorAddress,
          bucketMode: b.bucketMode,
          items: b.items,
          outboundWindow: b.outboundWindow,
          returnWindow: b.returnWindow,
          resaleWindow: b.resaleWindow,
        });
      }
    }

    const accumulateTierCosts = (rates: any[]) => {
      for (const rate of rates) {
        if (!rate?.pricingTier) continue;
        const tierCost = Math.ceil(
          (rate.cost || RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO) / 100,
        );
        const displayName =
          (rate.name && String(rate.name).trim()) || rate.pricingTier;
        const existingTier = shippingTiersMap.get(rate.pricingTier);
        if (existingTier) {
          existingTier.totalShippingCost += tierCost;
        } else {
          shippingTiersMap.set(rate.pricingTier, {
            name: displayName,
            totalShippingCost: tierCost,
          });
        }
      }
    };

    const quoteMemo = createCheckoutSummaryTopshipMemo(this.topshipService);
    const summaryReceiverCity = renterDeliveryAddressSnapshot.city || 'Lagos';

    /** Warm shipment-rate quotes only (pickup quotes waived for customer pricing). */
    const topShipWarmup: Promise<any[]>[] = [];
    for (const ctx of bucketContexts) {
      const senderCity = ctx.curatorAddress?.city || 'Lagos';
      const ratePayload = {
        senderDetails: { cityName: senderCity, countryCode: 'NG' },
        receiverDetails: {
          cityName: summaryReceiverCity,
          countryCode: 'NG',
        },
        totalWeight: 1,
      };
      topShipWarmup.push(quoteMemo.shipRates(ratePayload));
      if (ctx.bucketMode === 'RENTAL') {
        topShipWarmup.push(
          quoteMemo.shipRates({
            senderDetails: {
              cityName: returnPickupAddressSnapshot.city || 'Lagos',
              countryCode: 'NG',
            },
            receiverDetails: { cityName: senderCity, countryCode: 'NG' },
            totalWeight: 1,
          }),
        );
      }
    }
    await Promise.all(topShipWarmup);

    const shippingResults = await Promise.all(
      bucketContexts.map(async (ctx) => {
        const senderCity = ctx.curatorAddress?.city || 'Lagos';

        const ratePayload = {
          senderDetails: { cityName: senderCity, countryCode: 'NG' },
          receiverDetails: {
            cityName: summaryReceiverCity,
            countryCode: 'NG',
          },
          totalWeight: 1,
        };

        const rateDataRaw = await quoteMemo.shipRates(ratePayload);

        let rateData =
          Array.isArray(rateDataRaw) && rateDataRaw.length > 0
            ? rateDataRaw
            : [];

        /** Pickup leg not quoted to customer for now (matches common Chowdeck pickup ₦0). */
        const pickupChargeNGN = 0;

        if (!rateData.length) {
          rateData = [
            {
              pricingTier: 'Budget',
              name: RELISTED_DISPATCH_SHIPPING_LABEL,
              cost: RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO,
            },
          ];
        }

        let returnRateData: any[] = [];
        const returnPickupChargeNGN = 0;

        if (ctx.bucketMode === 'RENTAL') {
          const returnRatePayload = {
            senderDetails: {
              cityName: returnPickupAddressSnapshot.city || 'Lagos',
              countryCode: 'NG',
            },
            receiverDetails: { cityName: senderCity, countryCode: 'NG' },
            totalWeight: 1,
          };

          const returnRateArrRaw = await quoteMemo.shipRates(returnRatePayload);

          returnRateData =
            Array.isArray(returnRateArrRaw) && returnRateArrRaw.length > 0
              ? returnRateArrRaw
              : [];

          if (!returnRateData.length) {
            returnRateData = [
              {
                pricingTier: 'Budget',
                name: RELISTED_DISPATCH_SHIPPING_LABEL,
                cost: RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO,
              },
            ];
          }
        }

        const preferredRate = pickPreferredRateSummary(rateData);
        const preferredShipping = Math.ceil(
          (preferredRate?.cost || RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO) / 100,
        );

        let preferredReturnShipping = 0;
        if (ctx.bucketMode === 'RENTAL') {
          const preferredReturnRate =
            this.findRateByTier(returnRateData, preferredRate?.pricingTier) ||
            pickPreferredRateSummary(returnRateData);
          preferredReturnShipping = Math.ceil(
            (preferredReturnRate?.cost || RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO) /
              100,
          );
        }

        return {
          listerId: ctx.listerId,
          listerName: ctx.listerName,
          bucketMode: ctx.bucketMode,
          productIds: ctx.items.map((i: any) => i.product?.id),
          outboundDeliveryWindow:
            ctx.outboundWindow &&
            ({
              start: ctx.outboundWindow.start.toISOString(),
              end: ctx.outboundWindow.end.toISOString(),
            } as const),
          returnPickupWindow:
            ctx.returnWindow &&
            ({
              start: ctx.returnWindow.start.toISOString(),
              end: ctx.returnWindow.end.toISOString(),
            } as const),
          resaleDeliveryWindow:
            ctx.resaleWindow &&
            ({
              start: ctx.resaleWindow.start.toISOString(),
              end: ctx.resaleWindow.end.toISOString(),
            } as const),
          pickupChargeNGN,
          preferredShipping,
          preferredReturnShipping,
          returnPickupChargeNGN,
          rateData,
          returnRateData,
        };
      }),
    );

    const shipmentBuckets = shippingResults.map((r) => ({
      listerId: r.listerId,
      listerName: r.listerName,
      bucketMode: r.bucketMode,
      productIds: r.productIds,
      outboundDeliveryWindow: r.outboundDeliveryWindow,
      returnPickupWindow: r.returnPickupWindow,
      resaleDeliveryWindow: r.resaleDeliveryWindow,
      outboundShippingCost: r.preferredShipping,
      returnShippingCost:
        r.bucketMode === 'RENTAL' ? r.preferredReturnShipping : 0,
      outboundPickupCost: r.pickupChargeNGN,
      returnPickupCost:
        r.bucketMode === 'RENTAL' ? r.returnPickupChargeNGN : 0,
    }));

    for (const lister of listerData) {
      globalRentalTotal += lister.listerRentalTotal;
      globalCollateralTotal += lister.listerCollateralTotal;
      globalCleaningTotal += lister.listerCleaningTotal;
      globalVatTotal += lister.listerVatTotal;
      globalServiceChargeTotal += lister.listerServiceChargeTotal;
      globalPurchaseTotal += lister.listerPurchaseTotal;
    }

    const breakdownByLister = new Map<
      string,
      {
        listerId: string;
        listerName: string;
        itemsCount: number;
        rentalTotal: number;
        collateralTotal: number;
        cleaningTotal: number;
        purchaseTotal: number;
        outboundShippingCost: number;
        returnShippingCost: number;
        outboundPickupCost: number;
        returnPickupCost: number;
        serviceCharge: number;
        vatAmount: number;
      }
    >();

    for (const lister of listerData) {
      breakdownByLister.set(lister.listerId, {
        listerId: lister.listerId,
        listerName: lister.items[0]?.product?.curator?.name || 'Unknown',
        itemsCount: lister.items.length,
        rentalTotal: lister.listerRentalTotal,
        collateralTotal: lister.listerCollateralTotal,
        cleaningTotal: lister.listerCleaningTotal,
        purchaseTotal: lister.listerPurchaseTotal,
        outboundShippingCost: 0,
        returnShippingCost: 0,
        outboundPickupCost: 0,
        returnPickupCost: 0,
        serviceCharge: lister.listerServiceChargeTotal,
        vatAmount: lister.listerVatTotal,
      });
    }

    for (const result of shippingResults) {
      accumulateTierCosts(result.rateData);
      if (result.bucketMode === 'RENTAL') {
        accumulateTierCosts(result.returnRateData);
      }

      globalPickupTotal +=
        result.pickupChargeNGN +
        (result.bucketMode === 'RENTAL' ? result.returnPickupChargeNGN : 0);
      globalOutboundShippingTotal += result.preferredShipping;
      globalReturnShippingTotal +=
        result.bucketMode === 'RENTAL' ? result.preferredReturnShipping : 0;
      globalOutboundPickupTotal += result.pickupChargeNGN;
      globalReturnPickupTotal +=
        result.bucketMode === 'RENTAL' ? result.returnPickupChargeNGN : 0;

      const agg = breakdownByLister.get(result.listerId);
      if (agg) {
        agg.outboundShippingCost += result.preferredShipping;
        agg.returnShippingCost +=
          result.bucketMode === 'RENTAL' ? result.preferredReturnShipping : 0;
        agg.outboundPickupCost += result.pickupChargeNGN;
        agg.returnPickupCost +=
          result.bucketMode === 'RENTAL' ? result.returnPickupChargeNGN : 0;
      }
    }

    for (const lister of listerData) {
      const row = breakdownByLister.get(lister.listerId)!;
      const shippingCost =
        row.outboundShippingCost + row.returnShippingCost;
      const pickupCost = row.outboundPickupCost + row.returnPickupCost;
      listerBreakdowns.push({
        listerId: row.listerId,
        listerName: row.listerName,
        itemsCount: row.itemsCount,
        rentalTotal: row.rentalTotal,
        collateralTotal: row.collateralTotal,
        cleaningTotal: row.cleaningTotal,
        purchaseTotal: row.purchaseTotal,
        shippingCost,
        pickupCost,
        outboundShippingCost: row.outboundShippingCost,
        returnShippingCost: row.returnShippingCost,
        outboundPickupCost: row.outboundPickupCost,
        returnPickupCost: row.returnPickupCost,
        serviceCharge: row.serviceCharge,
        vatAmount: row.vatAmount,
        listerGrandTotal:
          row.rentalTotal +
          row.collateralTotal +
          row.cleaningTotal +
          row.purchaseTotal +
          shippingCost +
          pickupCost +
          row.vatAmount +
          row.serviceCharge,
      });
    }

    const itemTotalsBase =
      globalRentalTotal +
      globalCollateralTotal +
      globalCleaningTotal +
      globalPurchaseTotal +
      globalPickupTotal;

    // Map the aggregated shipping tiers into the response array
    const preferredTierOrder = ['chowdeck', 'glovo'];
    const preferredTierIndex = new Map(
      preferredTierOrder.map((t, i) => [t, i] as const),
    );
    const shippingTiers = Array.from(shippingTiersMap.values())
      .map((tier) => ({
        name: tier.name,
        totalShippingCost: tier.totalShippingCost,
        grandTotal: itemTotalsBase + tier.totalShippingCost,
      }))
      .sort((a, b) => {
        const aKey = String(a.name).trim().toLowerCase();
        const bKey = String(b.name).trim().toLowerCase();
        const aPref = preferredTierIndex.get(aKey) ?? Number.MAX_SAFE_INTEGER;
        const bPref = preferredTierIndex.get(bKey) ?? Number.MAX_SAFE_INTEGER;
        if (aPref !== bPref) return aPref - bPref;
        return a.totalShippingCost - b.totalShippingCost;
      });

    // For backwards compatibility and baseline metrics
    const baselineShippingTotal =
      shippingTiers.length > 0
        ? shippingTiers[0].totalShippingCost
        : Math.ceil(RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO / 100);
    const baselineGrandTotal =
      itemTotalsBase + baselineShippingTotal + globalServiceChargeTotal + globalVatTotal;

    return {
      success: true,
      message: 'Checkout summary calculated successfully',
      data: {
        summary: {
          rentalTotal: globalRentalTotal,
          collateralTotal: globalCollateralTotal,
          cleaningTotal: globalCleaningTotal,
          purchaseTotal: globalPurchaseTotal,
          pickupTotal: globalPickupTotal,
          shippingTotal: baselineShippingTotal,
          outboundShippingTotal: globalOutboundShippingTotal,
          returnShippingTotal: globalReturnShippingTotal,
          outboundPickupTotal: globalOutboundPickupTotal,
          returnPickupTotal: globalReturnPickupTotal,
          returnTotal: globalReturnShippingTotal + globalReturnPickupTotal,
          serviceCharge: globalServiceChargeTotal,
          vatAmount: globalVatTotal,
          grandTotal: baselineGrandTotal,
        },
        shippingTiers,
        listerBreakdowns,
        shipmentBuckets,
      },
    };
  }

  async checkout(
    user: userEntity,
    checkoutOptions?: string | CreateOrderDto,
  ) {
    console.log('============================================');
    console.log('[CHECKOUT START] User:', user.email, 'at', new Date().toISOString());
    console.log('============================================');
    const {
      pricingTier: selectedPricingTier,
      dispatchWindows,
      returnPickupAddress,
    } =
      typeof checkoutOptions === 'string' || checkoutOptions === undefined
        ? {
            pricingTier: checkoutOptions,
            dispatchWindows: undefined,
            returnPickupAddress: undefined,
          }
        : {
            pricingTier: checkoutOptions.pricingTier,
            dispatchWindows: checkoutOptions.dispatchWindows,
            returnPickupAddress: checkoutOptions.returnPickupAddress,
          };
    const dispatchWindowsInput =
      dispatchWindows as DispatchWindowsInput | undefined;
    const returnPickupAddressInput = returnPickupAddress;

    const renterProfile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { address: true },
    });

    // Topship usually needs cities, fallback if no address
    if (!renterProfile?.address) {
      bad('Please add a delivery address to your profile before checkout.');
    }

    const renterDeliveryAddressSnapshot =
      this.buildRenterDeliveryAddressSnapshot(user, renterProfile);
    const returnPickupAddressSnapshot =
      this.buildReturnPickupAddressSnapshot(
        renterDeliveryAddressSnapshot,
        renterProfile,
        returnPickupAddressInput,
      );

    const cart = await this.prisma.cart.findUnique({
      where: { userId: user.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                curator: {
                  include: {
                    profile: { include: { address: true, businessInfo: true } },
                  },
                },
                brand: true,
                category: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      bad('Cart is empty');
    }

    const eligibleItems = await this.cartItemsApprovedForCheckout(
      user.id,
      cart.items,
    );
    if (eligibleItems.length === 0) {
      bad(
        'No items are approved for checkout yet. Wait for lister approval before paying.',
      );
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: user.id },
    });
    if (!wallet) bad('Wallet not found. Please fund your wallet first.');

    const createdShipmentIds: string[] = [];
    let totalDeliveryFee = 0;
    let totalOutboundShippingFee = 0;
    let totalReturnShippingFee = 0;
    let totalOutboundPickupFee = 0;
    let totalReturnPickupFee = 0;

    // Group items by lister
    const itemsByLister = new Map<string, any[]>();
    for (const item of eligibleItems) {
      const listerId = item.product.curatorId;
      if (!itemsByLister.has(listerId)) {
        itemsByLister.set(listerId, []);
      }
      itemsByLister.get(listerId)!.push(item);
    }

    // Get unique lister IDs for the order
    const listerIds = Array.from(itemsByLister.keys());

    let grandTotal = 0;
    let totalCollateral = 0;
    const listerOrdersData: any[] = [];
    /**
     * Same memo pattern as GET /order summary: identical sender/receiver payloads share one
     * cached Topship response. Sequential awaits per bucket only (no parallel Topship fan-out).
     */
    const topshipRateMemo = createCheckoutSummaryTopshipMemo(this.topshipService);

    // Calculate totals and shipping per schedule bucket (multiple legs per lister when dates differ)
    for (const [listerId, items] of itemsByLister.entries()) {
      const scheduleBuckets = this.buildShipmentBucketsForLister(
        items,
        dispatchWindowsInput,
      );

      for (const bucket of scheduleBuckets) {
        const bucketItems = bucket.items;
        let listerItemsTotal = 0;
        let listerRentalAndCleaning = 0;
        let listerCollateralTotal = 0;
        let listerVatTotal = 0;
        let listerServiceChargeTotal = 0;
        let curatorAddress: any = null;
        const hasRentalBucket = bucket.bucketMode === 'RENTAL';

      for (const item of bucketItems) {
        // Check product is active, verified, and not sold
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (!item.product.productVerified)
          bad(`${item.product.name} is not verified by admin`);
        if (item.product.status === 'SOLD')
          bad(`${item.product.name} is already sold`);

        curatorAddress =
          item.product.curator.profile?.address ||
          item.product.curator.profile?.businessInfo;

        let itemTotal = 0;
        let rentalAmount = 0;
        let collateralAmount = 0;
        let cleaningFee = 0;
        let vatAmount = 0;
        let serviceCharge = 0;

        if (item.product.listingType === 'RESALE') {
          // RESALE flow: only sale price, no collateral or cleaning
          if (!item.product.resalePrice || item.product.resalePrice <= 0) {
            bad(
              `${item.product.name} has invalid resale price for RESALE listing`,
            );
          }
          rentalAmount = 0;
          collateralAmount = 0;
          cleaningFee = 0;
          vatAmount = Math.round(item.product.resalePrice * 0.075);
          serviceCharge = Math.round(item.product.resalePrice * 0.1);
          itemTotal = item.product.resalePrice + vatAmount + serviceCharge;
        } else if (item.product.listingType === 'RENT_OR_RESALE') {
          // RENT_OR_RESALE flow: can be either rental or resale based on context
          if (item.days > 0) {
            // Rental path
            if (!item.product.dailyPrice) {
              bad(`${item.product.name} is missing daily price for rental`);
            }
            rentalAmount = item.product.dailyPrice * item.days;
            collateralAmount =
              Number(
                item.product.collateralPrice || item.product.originalValue,
              ) || 0;
            cleaningFee = DEFAULT_CLEANING_FEE_NGN;
            vatAmount = Math.round(rentalAmount * 0.075);
            serviceCharge = Math.round(rentalAmount * 0.1);
            itemTotal =
              rentalAmount +
              collateralAmount +
              cleaningFee +
              vatAmount +
              serviceCharge;
            listerRentalAndCleaning += rentalAmount + cleaningFee;
          } else {
            // Resale path
            if (!item.product.resalePrice || item.product.resalePrice <= 0) {
              bad(
                `${item.product.name} has invalid resale price for RESALE listing`,
              );
            }
            rentalAmount = 0;
            collateralAmount = 0;
            cleaningFee = 0;
            vatAmount = Math.round(item.product.resalePrice * 0.075);
            serviceCharge = Math.round(item.product.resalePrice * 0.1);
            itemTotal = item.product.resalePrice + vatAmount + serviceCharge;
          }
        } else {
          // RENTAL flow: original logic
          if (item.days <= 0) bad('Invalid rental duration');
          if (!item.product.dailyPrice) {
            bad(
              `${item.product.name} is missing daily price for RENTAL listing`,
            );
          }
          rentalAmount = item.product.dailyPrice * item.days;
          collateralAmount =
            Number(
              item.product.collateralPrice || item.product.originalValue,
            ) || 0;
          cleaningFee = DEFAULT_CLEANING_FEE_NGN;
          vatAmount = Math.round(rentalAmount * 0.075);
          serviceCharge = Math.round(rentalAmount * 0.1);
          itemTotal =
            rentalAmount +
            collateralAmount +
            cleaningFee +
            vatAmount +
            serviceCharge;
          listerRentalAndCleaning += rentalAmount + cleaningFee;
        }

        listerItemsTotal += itemTotal;
        listerCollateralTotal += collateralAmount;
        listerVatTotal += vatAmount;
        listerServiceChargeTotal += serviceCharge;
      }
      totalCollateral += listerCollateralTotal;

      const outboundWindow = bucket.outboundWindow;
      const returnWindow = bucket.returnWindow;
      const resaleWindow = bucket.resaleWindow;

      // Calculate shipping & pickup
      // Provide fallback cities if missing in testing
      const senderCity = curatorAddress?.city || 'Lagos'; // Using Lagos as fallback for staging
      const receiverCity = renterDeliveryAddressSnapshot.city || 'Lagos';

      const checkoutDeliveryLocationLine = this.formatAddressSnapshotLine(
        renterDeliveryAddressSnapshot,
      );
      const listerDestinationLine = this.formatAddressSnapshotLine({
        street: curatorAddress?.street,
        city: curatorAddress?.city,
        state: curatorAddress?.state,
      });

      /** Customer pickup leg waived for pricing; persisted shipment rows use ₦0 pickup. */
      let pickupChargeRaw = 0;
      let pickupId = '';
      let pickupPartner = this.normalizeTopshipTier(selectedPricingTier);
      const pickupCostNGN = 0;

      let shippingCost = 0;
      let shipmentChargeRaw = RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO;
      let shipmentVatChargeRaw = 0;
      let returnShippingCost = 0;
      let returnShipmentChargeRaw = 0;
      let returnShipmentVatChargeRaw = 0;
      try {
        const ratePayload = {
          senderDetails: { cityName: senderCity, countryCode: 'NG' },
          receiverDetails: { cityName: receiverCity, countryCode: 'NG' },
          totalWeight: 1, // Default weight 1kg
        };
        const rateData = await topshipRateMemo.shipRates(ratePayload);
        if (process.env.DEBUG_TOPSHIP_RATES === '1') {
          console.log(
            `[Checkout] Outbound quote rows (${senderCity}→${receiverCity}):`,
            Array.isArray(rateData) ? rateData.length : 0,
          );
        }

        let matchedRate =
          this.findRateByTier(rateData, selectedPricingTier) || rateData?.[0];

        if (matchedRate) {
          shipmentChargeRaw = Number(matchedRate.cost) || 0;
          // Topship VAT is always 7.5% of totalCharge (which is just shipmentCharge, not including pickupCharge)
          // Use Math.ceil to match Topship's rounding behavior
          shipmentVatChargeRaw = Math.ceil(shipmentChargeRaw * 0.075);
          const tierSlug = String(matchedRate.pricingTier ?? '')
            .trim()
            .toLowerCase();
          if (tierSlug) pickupPartner = tierSlug;
        }
        // Pick selected or fallback price and convert from Kobo to NGN
        shippingCost = Math.ceil(shipmentChargeRaw / 100);
      } catch (err: any) {
        console.warn(
          `Shipping calculation failed between ${senderCity} and ${receiverCity}. Reason:`,
          err.message,
        );
        shippingCost = Math.ceil(RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO / 100);
      }

      let returnPickupChargeRaw = 0;
      let returnPickupCostNGN = 0;
      let returnPickupId = '';
      let returnPickupPartner = pickupPartner;
      if (hasRentalBucket) {
        try {
          const returnRatePayload = {
            senderDetails: {
              cityName: returnPickupAddressSnapshot.city || 'Lagos',
              countryCode: 'NG',
            },
            receiverDetails: { cityName: senderCity, countryCode: 'NG' },
            totalWeight: 1,
          };
          const returnRateData =
            await topshipRateMemo.shipRates(returnRatePayload);
          if (process.env.DEBUG_TOPSHIP_RATES === '1') {
            console.log(
              `[Checkout] Return quote rows (→${senderCity}):`,
              Array.isArray(returnRateData) ? returnRateData.length : 0,
            );
          }

          let matchedReturnRate =
            this.findRateByTier(returnRateData, selectedPricingTier) ||
            returnRateData?.[0];
          if (matchedReturnRate) {
            returnShipmentChargeRaw = Number(matchedReturnRate.cost) || 0;
            returnShipmentVatChargeRaw = Math.ceil(
              returnShipmentChargeRaw * 0.075,
            );
            const rt = String(matchedReturnRate.pricingTier ?? '')
              .trim()
              .toLowerCase();
            if (rt) returnPickupPartner = rt;
          }
          returnShippingCost = Math.ceil(returnShipmentChargeRaw / 100);
        } catch (err: any) {
          console.warn(
            `Return shipping calculation failed between ${
              returnPickupAddressSnapshot.city || 'Lagos'
            } and ${senderCity}. Reason:`,
            err.message,
          );
          returnShippingCost = hasRentalBucket
            ? Math.ceil(RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO / 100)
            : 0;
          if (hasRentalBucket) {
            returnShipmentChargeRaw = RELISTED_DISPATCH_FALLBACK_SHIPMENT_KOBO;
            returnShipmentVatChargeRaw = Math.ceil(returnShipmentChargeRaw * 0.075);
          }
        }
      }

      const listerGrandTotal =
        listerItemsTotal +
        shippingCost +
        pickupCostNGN +
        returnShippingCost +
        returnPickupCostNGN;
      grandTotal += listerGrandTotal;

      listerOrdersData.push({
        listerId,
        bucketMode: bucket.bucketMode,
        items: bucketItems,
        listerGrandTotal,
        listerRentalAndCleaning,
        listerCollateralTotal,
        listerVatTotal,
        listerServiceChargeTotal,
        shippingCost,
        returnShippingCost,
        usedPricingTier: selectedPricingTier || 'Budget',
        pickupChargeRaw,
        deliveryLocation: checkoutDeliveryLocationLine,
        pickupId,
        pickupPartner,
        shipmentChargeRaw,
        shipmentVatChargeRaw,
        returnShipmentChargeRaw,
        returnShipmentVatChargeRaw,
        returnPickupChargeRaw,
        returnPickupCostNGN,
        returnPickupPartner,
        returnPickupId,
        returnDeliveryLocation: listerDestinationLine,
        outboundWindow,
        returnWindow,
        resaleWindow,
      });
      }
    }

    if (wallet.mainBalance < grandTotal) {
      bad(
        `Insufficient wallet balance. Total cost is NGN ${grandTotal}, but your available balance is NGN ${wallet.mainBalance}.`,
      );
    }

    const shipmentDispatchPlan: Array<{
      id: string;
      immediate: boolean;
      manualFulfillment: boolean;
    }> = [];

    // Process transaction and orders
    let order: any;
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Deduct wallet & lock collateral
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            availableBalance: { decrement: grandTotal },
            mainBalance: { decrement: grandTotal - totalCollateral },
            collateralBalance: { increment: totalCollateral },
          },
        });

        // 2. Create Wallet Transaction for Renter
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: -grandTotal, // Negative for deduction
            type: 'MAIN',
            status: 'SUCCESS',
            note:
              'Cart checkout payment for ' +
              eligibleItems.length +
              ' items (Collateral locked: ' +
              totalCollateral +
              ')',
          },
        });

        // 3. Create ONE order with all items (multi-lister support)
        const now = new Date();
        const orderIdStr = await this.generateOrderId();

        // Determine overall order listing type
        const hasResaleItems = eligibleItems.some(
          (item) =>
            item.product.listingType === 'RESALE' ||
            (item.product.listingType === 'RENT_OR_RESALE' && item.days === 0),
        );
        const hasRentalItems = eligibleItems.some(
          (item) =>
            item.product.listingType === 'RENTAL' ||
            (item.product.listingType === 'RENT_OR_RESALE' && item.days > 0),
        );
        const orderListingType =
          hasResaleItems && hasRentalItems
            ? 'RENT_OR_RESALE'
            : hasResaleItems
              ? 'RESALE'
              : 'RENTAL';

        // Calculate total service fee and VAT across all listers
        const totalServiceFee = listerOrdersData.reduce(
          (sum, ld) => sum + (ld.listerServiceChargeTotal ?? 0),
          0,
        );
        const totalVat = listerOrdersData.reduce(
          (sum, ld) => sum + ld.listerVatTotal,
          0,
        );
        totalDeliveryFee = listerOrdersData.reduce(
          (sum, ld) =>
            sum +
            ld.shippingCost +
            (ld.returnShippingCost || 0) +
            Math.ceil(ld.pickupChargeRaw / 100) +
            Math.ceil((ld.returnPickupChargeRaw || 0) / 100),
          0,
        );
        totalOutboundShippingFee = listerOrdersData.reduce(
          (sum, ld) => sum + ld.shippingCost,
          0,
        );
        totalReturnShippingFee = listerOrdersData.reduce(
          (sum, ld) => sum + (ld.returnShippingCost || 0),
          0,
        );
        totalOutboundPickupFee = listerOrdersData.reduce(
          (sum, ld) => sum + Math.ceil(ld.pickupChargeRaw / 100),
          0,
        );
        totalReturnPickupFee = listerOrdersData.reduce(
          (sum, ld) => sum + Math.ceil((ld.returnPickupChargeRaw || 0) / 100),
          0,
        );

        // Validate product availability for all items
        for (const item of eligibleItems) {
          const product = await tx.product.findUnique({
            where: { id: item.product.id },
          });
          if (!product?.isActive) {
            throw new BadRequestException(`${item.product.name} is not active`);
          }
          if (!product?.productVerified) {
            throw new BadRequestException(
              `${item.product.name} is not verified by admin`,
            );
          }
          if (product?.status === 'SOLD') {
            throw new BadRequestException(
              `${item.product.name} is already sold`,
            );
          }

          // Check overlapping rentals
          const newRentalStart = item.startDate
            ? new Date(item.startDate)
            : new Date();
          const newRentalEnd = item.endDate
            ? new Date(item.endDate)
            : new Date();
          const bufferDays = 1;
          const bufferMs = bufferDays * 24 * 60 * 60 * 1000;

          const activeRental = await tx.rental.findFirst({
            where: {
              productId: item.product.id,
              isReturned: false,
              OR: [
                { endDate: { gt: new Date() } },
                {
                  endDate: {
                    gte: new Date(newRentalStart.getTime() - bufferMs),
                  },
                },
                {
                  startDate: {
                    lte: new Date(newRentalEnd.getTime() + bufferMs),
                  },
                },
              ],
            },
          });
          if (activeRental) {
            throw new BadRequestException(
              `${item.product.name} has an overlapping rental period. Please choose different dates.`,
            );
          }

          // Check concurrent orders
          const isResaleItem =
            item.product.listingType === 'RESALE' ||
            (item.product.listingType === 'RENT_OR_RESALE' && item.days === 0);
          const isRentalItem =
            item.product.listingType === 'RENTAL' ||
            (item.product.listingType === 'RENT_OR_RESALE' && item.days > 0);

          if (isResaleItem) {
            const activeResaleOrder = await tx.order.findFirst({
              where: {
                orderItems: { some: { productId: item.product.id } },
                listingType: { in: ['RESALE', 'RENT_OR_RESALE'] },
                status: {
                  in: [
                    'PROCESSING',
                    'ACCEPTED',
                    'CONFIRMED',
                    'IN_TRANSIT',
                    'DELIVERED',
                    'ACTIVE',
                    'COMPLETED',
                  ],
                },
              },
            });
            if (activeResaleOrder) {
              throw new BadRequestException(
                `${item.product.name} already has a pending or completed resale order`,
              );
            }
          }

          if (isRentalItem) {
            const activeRentalOrder = await tx.order.findFirst({
              where: {
                orderItems: { some: { productId: item.product.id } },
                listingType: { in: ['RENTAL', 'RENT_OR_RESALE'] },
                status: {
                  in: [
                    'PROCESSING',
                    'ACCEPTED',
                    'ACTIVE',
                    'DELIVERED',
                    'RETURN_DUE',
                  ],
                },
              },
            });
            if (activeRentalOrder) {
              throw new BadRequestException(
                `${item.product.name} already has an active rental order`,
              );
            }
          }
        }

        // Create single order with all items
        order = await tx.order.create({
          data: {
            orderId: orderIdStr,
            userId: user.id,
            expiresAt: null,
            listingType: orderListingType,
            status: OrderStatus.CONFIRMED,
            ...(hasRentalItems ? { approvedAt: now } : {}),
            totalAmountPaid: grandTotal,
            deliveryFee: totalDeliveryFee,
            serviceFee: totalServiceFee,
            vatAmount: totalVat,
            orderListers: {
              create: listerIds.map((listerId: string) => ({
                listerId,
              })),
            },
          },
        });

        const cartItemIdToOrderItemId = new Map<string, string>();

        // Create order items for all items
        for (const item of eligibleItems) {
          const isResalePurchase =
            item.product.listingType === 'RESALE' ||
            (item.product.listingType === 'RENT_OR_RESALE' && item.days === 0);
          const collateralFee = isResalePurchase
            ? 0
            : Number(
                item.product.collateralPrice || item.product.originalValue,
              ) || 0;

          const createdOi = await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.product.id,
              days: isResalePurchase ? 0 : item.days,
              pricePerDay: isResalePurchase ? 0 : item.product.dailyPrice || 0,
              imageUrl: item.product.attachments?.uploads?.[0]?.url || null,
              rentalFee: isResalePurchase
                ? 0
                : (item.product.dailyPrice || 0) * item.days,
              cleaningFee: isResalePurchase ? 0 : DEFAULT_CLEANING_FEE_NGN,
              collateralFee,
            } as any,
          });
          cartItemIdToOrderItemId.set(item.id, createdOi.id);
        }

        for (const item of eligibleItems) {
          const isRentalItem =
            item.days > 0 &&
            (item.product.listingType === 'RENTAL' ||
              item.product.listingType === 'RENT_OR_RESALE');
          if (!isRentalItem) continue;

          const startDate = item.startDate ? new Date(item.startDate) : now;
          const endDate = item.endDate
            ? new Date(item.endDate)
            : addDays(startDate, item.days);

          const existingRental = await tx.rental.findFirst({
            where: {
              orderId: order.id,
              productId: item.product.id,
            },
            select: { id: true },
          });

          if (!existingRental) {
            await tx.rental.create({
              data: {
                orderId: order.id,
                userId: user.id,
                productId: item.product.id,
                curatorId: item.product.curatorId,
                days: item.days,
                totalAmount: (item.product.dailyPrice || 0) * item.days,
                startDate,
                endDate,
              },
            });
          }
        }

        // Update product status for all items
        for (const item of eligibleItems) {
          const isRentalItem =
            item.product.listingType === 'RENTAL' ||
            (item.product.listingType === 'RENT_OR_RESALE' && item.days > 0);
          const isResaleItem =
            item.product.listingType === 'RESALE' ||
            (item.product.listingType === 'RENT_OR_RESALE' && item.days === 0);

          if (isRentalItem) {
            await tx.product.update({
              where: { id: item.product.id },
              data: { status: 'RENTED' },
            });
          } else if (isResaleItem) {
            await tx.product.update({
              where: { id: item.product.id },
              data: { status: 'SOLD' },
            });
          }
        }

        // Create escrows per lister (one escrow per lister per order); merge shipment buckets per curator
        const escrowMergedByLister = new Map<
          string,
          {
            listerId: string;
            items: any[];
            listerRentalAndCleaning: number;
            listerCollateralTotal: number;
          }
        >();
        for (const ld of listerOrdersData) {
          let row = escrowMergedByLister.get(ld.listerId);
          if (!row) {
            row = {
              listerId: ld.listerId,
              items: [],
              listerRentalAndCleaning: 0,
              listerCollateralTotal: 0,
            };
            escrowMergedByLister.set(ld.listerId, row);
          }
          row.items.push(...ld.items);
          row.listerRentalAndCleaning += ld.listerRentalAndCleaning ?? 0;
          row.listerCollateralTotal += ld.listerCollateralTotal ?? 0;
        }

        for (const listerData of escrowMergedByLister.values()) {
          const isResaleOrder = listerData.items.some(
            (item) =>
              item.product.listingType === 'RESALE' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days === 0),
          );
          const hasRentalItem = listerData.items.some(
            (item) =>
              item.product.listingType === 'RENTAL' ||
              (item.product.listingType === 'RENT_OR_RESALE' && item.days > 0),
          );
          const isMixedOrder = isResaleOrder && hasRentalItem;

          if (isMixedOrder) {
            const totalRentalAmount = listerData.listerRentalAndCleaning;
            const totalCollateralAmount = listerData.listerCollateralTotal;
            const totalCleaningFee = listerData.items.reduce(
              (sum, item) =>
                sum + (item.days > 0 ? DEFAULT_CLEANING_FEE_NGN : 0),
              0,
            );
            const totalSalePrice = listerData.items.reduce((sum, item) => {
              if (
                item.product.listingType === 'RESALE' ||
                (item.product.listingType === 'RENT_OR_RESALE' &&
                  item.days === 0)
              ) {
                return sum + (item.product.resalePrice || 0);
              }
              return sum;
            }, 0);

            await tx.escrow.create({
              data: {
                orderId: order.id,
                listerId: listerData.listerId,
                renterId: user.id,
                rentalAmount: totalRentalAmount,
                resaleAmount: totalSalePrice,
                collateralAmount: totalCollateralAmount,
                cleaningFee: totalCleaningFee,
                status: 'LOCKED',
              },
            });
          } else if (isResaleOrder && !hasRentalItem) {
            const totalSalePrice = listerData.items.reduce((sum, item) => {
              const isResaleItem =
                item.product.listingType === 'RESALE' ||
                (item.product.listingType === 'RENT_OR_RESALE' &&
                  item.days === 0);
              if (isResaleItem) {
                return sum + (item.product.resalePrice || 0);
              }
              return sum;
            }, 0);

            await tx.escrow.create({
              data: {
                orderId: order.id,
                listerId: listerData.listerId,
                renterId: user.id,
                rentalAmount: 0,
                resaleAmount: totalSalePrice,
                collateralAmount: 0,
                cleaningFee: 0,
                status: 'LOCKED',
              },
            });
          } else {
            const totalRentalAmount = listerData.listerRentalAndCleaning;
            const totalCollateralAmount = listerData.listerCollateralTotal;
            const totalCleaningFee = listerData.items.reduce(
              (sum, item) =>
                sum + (item.days > 0 ? DEFAULT_CLEANING_FEE_NGN : 0),
              0,
            );

            await tx.escrow.create({
              data: {
                orderId: order.id,
                listerId: listerData.listerId,
                renterId: user.id,
                rentalAmount: totalRentalAmount,
                resaleAmount: 0,
                collateralAmount: totalCollateralAmount,
                cleaningFee: totalCleaningFee,
                status: 'LOCKED',
              },
            });
          }
        }

        for (const ld of listerOrdersData) {
          const createdShipments = await this.createCheckoutShipments(
            tx,
            order.id,
            ld,
            renterDeliveryAddressSnapshot,
          );
          shipmentDispatchPlan.push(
            ...createdShipments.map((s) => ({
              id: s.id,
              immediate: s.immediate,
              manualFulfillment: s.manualFulfillment,
            })),
          );

          const outboundId = createdShipments.find((s) => s.type === 'OUTBOUND')
            ?.id;
          const returnId = createdShipments.find((s) => s.type === 'RETURN')
            ?.id;
          const resaleId = createdShipments.find((s) => s.type === 'RESALE')
            ?.id;

          for (const cartLine of ld.items) {
            const oiId = cartItemIdToOrderItemId.get(cartLine.id);
            if (!oiId) continue;
            const orderItemShipmentData: Prisma.OrderItemUncheckedUpdateInput =
              {};
            if (ld.bucketMode === 'RENTAL') {
              orderItemShipmentData.outboundShipmentId = outboundId ?? null;
              const lineIsRental =
                cartLine.days > 0 &&
                (cartLine.product.listingType === 'RENTAL' ||
                  cartLine.product.listingType === 'RENT_OR_RESALE');
              if (lineIsRental) {
                orderItemShipmentData.returnShipmentId = returnId ?? null;
              } else {
                orderItemShipmentData.returnShipmentId = null;
              }
            } else if (ld.bucketMode === 'RESALE') {
              orderItemShipmentData.resaleShipmentId = resaleId ?? null;
            }
            if (Object.keys(orderItemShipmentData).length === 0) continue;
            await tx.orderItem.update({
              where: { id: oiId },
              data: orderItemShipmentData,
            });
          }
        }
      });

    for (const row of shipmentDispatchPlan) {
      createdShipmentIds.push(row.id);
      if (!row.immediate || row.manualFulfillment) continue;
      const locked = await this.prisma.shipment.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'DISPATCHING' },
      });
      if (locked.count > 0) {
        await this.shipmentDispatchQueue.add(
          'dispatch',
          { shipmentId: row.id },
          { attempts: 1 },
        );
      }
    }

    const manualShipmentIds = shipmentDispatchPlan
      .filter((r) => r.manualFulfillment)
      .map((r) => r.id);
    if (manualShipmentIds.length > 0 && order?.orderId) {
      try {
        await this.notifyAdminsManualFulfillmentCheckout(
          order.orderId,
          manualShipmentIds,
        );
      } catch (err: any) {
        console.warn(
          `[OrderService] Admin notify (manual fulfillment) failed:`,
          err?.message ?? err,
        );
      }
    }

    const cartItemIds = eligibleItems.map((item: any) => item.id);
    if (cartItemIds.length > 0) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id, id: { in: cartItemIds } },
      });
    }

    try {
      const notifyMergedByLister = new Map<
        string,
        { items: any[]; listerRentalAndCleaning: number }
      >();
      for (const ld of listerOrdersData) {
        let row = notifyMergedByLister.get(ld.listerId);
        if (!row) {
          row = { items: [], listerRentalAndCleaning: 0 };
          notifyMergedByLister.set(ld.listerId, row);
        }
        row.items.push(...ld.items);
        row.listerRentalAndCleaning += ld.listerRentalAndCleaning ?? 0;
      }

      for (const listerNotify of notifyMergedByLister.values()) {
        const mergedItems = listerNotify.items;
        const lister = mergedItems[0]?.product?.curator;
        if (lister?.email) {
          const rentalLines = mergedItems.filter(
            (item: any) =>
              item.days > 0 &&
              (item.product.listingType === 'RENTAL' ||
                item.product.listingType === 'RENT_OR_RESALE'),
          );
          const listerCleaningFeesTotal =
            rentalLines.length * DEFAULT_CLEANING_FEE_NGN;
          const listerRentalSubtotal = Math.max(
            0,
            (listerNotify.listerRentalAndCleaning || 0) -
              listerCleaningFeesTotal,
          );
          const listerResaleSubtotal = mergedItems.reduce(
            (sum: number, item: any) => {
              const isResale =
                item.product.listingType === 'RESALE' ||
                (item.product.listingType === 'RENT_OR_RESALE' &&
                  item.days === 0);
              return isResale ? sum + (item.product.resalePrice || 0) : sum;
            },
            0,
          );
          const listerMerchandiseTotal =
            listerRentalSubtotal +
            listerCleaningFeesTotal +
            listerResaleSubtotal;

          const listerIdForNotify = String(lister.id);
          const dispatchItemWindowsAccum: Array<{
            productName: string;
            rentalDeliveryWindowText: string | null;
            returnPickupWindowText: string | null;
            purchaseDeliveryWindowText: string | null;
            sortKey: number;
          }> = [];
          for (const ld of listerOrdersData) {
            if (String(ld.listerId) !== listerIdForNotify) continue;
            if (ld.bucketMode === 'RENTAL') {
              const ob = ld.outboundWindow;
              const rw = ld.returnWindow;
              const rentalDeliveryWindowText =
                ob?.start && ob?.end
                  ? this.formatDispatchWindowRangeForEmailLagos(
                      ob.start,
                      ob.end,
                    )
                  : null;
              const returnPickupWindowText =
                rw?.start && rw?.end
                  ? this.formatDispatchWindowRangeForEmailLagos(
                      rw.start,
                      rw.end,
                    )
                  : null;
              for (const bucketItem of ld.items ?? []) {
                dispatchItemWindowsAccum.push({
                  productName: bucketItem.product?.name || 'Item',
                  rentalDeliveryWindowText,
                  returnPickupWindowText,
                  purchaseDeliveryWindowText: null,
                  sortKey:
                    ob?.start?.getTime?.() ??
                    rw?.start?.getTime?.() ??
                    Date.now(),
                });
              }
            } else if (ld.bucketMode === 'RESALE') {
              const sw = ld.resaleWindow;
              const purchaseDeliveryWindowText =
                sw?.start && sw?.end
                  ? this.formatDispatchWindowRangeForEmailLagos(
                      sw.start,
                      sw.end,
                    )
                  : null;
              for (const bucketItem of ld.items ?? []) {
                dispatchItemWindowsAccum.push({
                  productName: bucketItem.product?.name || 'Item',
                  rentalDeliveryWindowText: null,
                  returnPickupWindowText: null,
                  purchaseDeliveryWindowText,
                  sortKey: sw?.start?.getTime?.() ?? Date.now(),
                });
              }
            }
          }
          dispatchItemWindowsAccum.sort((a, b) => a.sortKey - b.sortKey);
          const dispatchItemWindows = dispatchItemWindowsAccum.map(
            ({ sortKey: _sortKey, ...row }) => row,
          );

          await this.notificationService.createNotification({
            userId: lister.id,
            title: 'New Order Received',
            message: `You have a new order: ${order.orderId}. ${mergedItems.length} item(s) rented/purchased.`,
            type: 'ORDER_CONFIRMED',
            metadata: { orderId: order.id, orderNumber: order.orderId },
            sendEmail: true,
            emailData: {
              email: lister.email,
              curatorName: lister.name || 'Lister',
              renterName: user.name || 'Customer',
              orderId: order.orderId,
              totalAmount: listerMerchandiseTotal,
              platformName: 'Relisted',
              approvalLink: `${process.env.CLIENT_URL}/listers/orders/${order.id}`,
              listerNewOrderConfirmed: true,
              listerRentalSubtotal,
              listerCleaningFeesTotal,
              listerResaleSubtotal,
              listerMerchandiseTotal,
              dispatchItemWindows,
              hasDispatchItemWindows: dispatchItemWindows.length > 0,
              items: mergedItems.map((item: any) => {
                const daily = item.product?.dailyPrice || 0;
                const resale = item.product?.resalePrice || 0;
                const isRental =
                  item.days > 0 &&
                  (item.product.listingType === 'RENTAL' ||
                    item.product.listingType === 'RENT_OR_RESALE');
                const isResaleOnly =
                  item.product.listingType === 'RESALE' ||
                  (item.product.listingType === 'RENT_OR_RESALE' &&
                    item.days === 0);
                const rentLine = isRental ? daily * item.days : 0;
                const cleaningLine = isRental ? DEFAULT_CLEANING_FEE_NGN : 0;
                return {
                  productName: item.product?.name || 'Item',
                  days: item.days,
                  dailyPrice: daily,
                  isRental,
                  isResaleOnly,
                  rentLine,
                  cleaningLine,
                  price: isRental ? rentLine : resale,
                };
              }),
            },
          });
        }
      }
    } catch (notifyErr) {
      console.error('[Checkout] Error sending lister notifications:', notifyErr);
    }

    return {
      success: true,
      message:
        'Checkout successful. Order created. Your tracking link will be sent on your rental start date.',
      data: {
        ordersCreated: 1,
        totalPaid: grandTotal,
        fees: {
          deliveryFee: totalDeliveryFee,
          outboundShippingFee: totalOutboundShippingFee,
          returnShippingFee: totalReturnShippingFee,
          outboundPickupFee: totalOutboundPickupFee,
          returnPickupFee: totalReturnPickupFee,
          returnTotal: totalReturnShippingFee + totalReturnPickupFee,
        },
        selectedWindows: listerOrdersData.map((ld) => ({
          listerId: ld.listerId,
          listerName: ld.items[0]?.product?.curator?.name || 'Unknown',
          outboundDeliveryWindow: ld.outboundWindow
            ? {
                start: ld.outboundWindow.start.toISOString(),
                end: ld.outboundWindow.end.toISOString(),
              }
            : null,
          returnPickupWindow: ld.returnWindow
            ? {
                start: ld.returnWindow.start.toISOString(),
                end: ld.returnWindow.end.toISOString(),
              }
            : null,
          resaleDeliveryWindow: ld.resaleWindow
            ? {
                start: ld.resaleWindow.start.toISOString(),
                end: ld.resaleWindow.end.toISOString(),
              }
            : null,
        })),
        orders: [order],
        orderIds: [order.orderId],
        orderId: order.orderId,
        shipmentIds: createdShipmentIds,
      },
    };
  }

  async generateOrderId() {
    return `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  /**
   * Calculate the amount to release from escrow based on order type and escrow state
   * - RESALE orders: always release resaleAmount
   * - RENTAL orders: always release rentalAmount
   * - RENT_OR_RESALE orders: depends on actual transaction type and escrow state
   * - If escrow is PARTIALLY_RELEASED, rental was already released, so only release resale
   */
  private calculateEscrowReleaseAmount(order: any, escrow: any): number {
    const isRentalTransaction = order.orderItems.some(
      (item: any) => item.days > 0,
    );
    const isResaleTransaction = order.orderItems.some(
      (item: any) => item.days === 0,
    );
    const isPartiallyReleased = escrow.status === 'PARTIALLY_RELEASED';

    if (order.listingType === 'RESALE') {
      return escrow.resaleAmount ?? 0;
    }

    if (order.listingType === 'RENTAL') {
      return escrow.rentalAmount ?? 0;
    }

    if (order.listingType === 'RENT_OR_RESALE') {
      if (isPartiallyReleased) {
        // Rental already released on delivery, only release resale now
        return escrow.resaleAmount ?? 0;
      }

      if (isRentalTransaction && isResaleTransaction) {
        // Mixed order: release both amounts
        return (escrow.rentalAmount ?? 0) + (escrow.resaleAmount ?? 0);
      }

      if (isRentalTransaction) {
        // Pure rental (no resale items)
        return escrow.rentalAmount ?? 0;
      }

      if (isResaleTransaction) {
        // Pure resale (no rental items)
        return escrow.resaleAmount ?? 0;
      }
    }

    return 0;
  }

  async confirmResaleOrder(user: userEntity, orderId: string) {
    try {
      let order: any;
      await this.prisma.$transaction(async (tx) => {
        // Use pessimistic locking to prevent race conditions - lock the row during the initial query
        const lockedOrder = await tx.$queryRaw<
          Array<{
            id: string;
            orderId: string;
            userId: string;
            listingType: string;
            status: string;
            listerId: string | null;
            totalAmountPaid: number | null;
          }>
        >`
          SELECT * FROM "Order"
          WHERE "orderId" = ${orderId}
            AND "userId" = ${user.id}
            AND "listingType" IN ('RESALE', 'RENT_OR_RESALE')
            AND "status" = 'DELIVERED'
          FOR UPDATE
        `;

        if (!lockedOrder || lockedOrder.length === 0) {
          throw new BadRequestException(
            'Order not found or cannot be confirmed',
          );
        }

        // Fetch full order with relations after locking
        order = await tx.order.findFirst({
          where: { id: lockedOrder[0].id },
          include: {
            orderListers: true,
            orderItems: {
              include: {
                product: true,
              },
            },
          },
        });

        if (order.status === 'COMPLETED') {
          throw new BadRequestException('Order is already completed');
        }

        // Validate orderListers exists before making any state changes
        const listerIds = order.orderListers.map((ol: any) => ol.listerId);
        if (!listerIds || listerIds.length === 0) {
          throw new BadRequestException('Order lister IDs are missing');
        }

        // Update order status to COMPLETED
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'COMPLETED' },
        });

        // Update product status to SOLD and deactivate only for resale items
        for (const orderItem of order.orderItems) {
          // Check individual item's listingType to determine if it's a resale purchase
          const itemListingType = orderItem.product?.listingType;
          const isResaleItem =
            itemListingType === 'RESALE' ||
            (itemListingType === 'RENT_OR_RESALE' && orderItem.days === 0);

          if (isResaleItem) {
            await tx.product.update({
              where: { id: orderItem.productId },
              data: {
                status: 'SOLD',
                isActive: false,
              },
            });
          }
        }

        // Release escrows to lister wallets (per-lister escrows)
        const escrows = await tx.escrow.findMany({
          where: { orderId: order.id },
        });

        // Defensive check: escrows should exist for resale orders
        if (!escrows || escrows.length === 0) {
          throw new BadRequestException(
            'Escrow records not found for this order',
          );
        }

        // Determine transaction type for wallet transaction note
        const isRentalTransaction = order.orderItems.some(
          (item: any) => item.days > 0,
        );
        const isResaleTransaction = order.orderItems.some(
          (item: any) => item.days === 0,
        );

        // Release funds to each lister's escrow
        for (const escrow of escrows) {
          const releaseAmount = this.calculateEscrowReleaseAmount(
            order,
            escrow,
          );

          if (releaseAmount > 0) {
            // Credit lister wallet
            const listerWallet = await tx.wallet.upsert({
              where: { userId: escrow.listerId },
              create: {
                userId: escrow.listerId,
                mainBalance: releaseAmount,
                availableBalance: releaseAmount,
              },
              update: {
                mainBalance: { increment: releaseAmount },
                availableBalance: { increment: releaseAmount },
              },
            });

            // Create wallet transaction for lister
            await tx.walletTransaction.create({
              data: {
                walletId: listerWallet.id,
                amount: releaseAmount,
                type: 'MAIN',
                status: 'SUCCESS',
                note:
                  isRentalTransaction && isResaleTransaction
                    ? `Payment released for completed mixed order ${order.orderId} (rental + resale)`
                    : isRentalTransaction
                      ? `Payment released for completed rental order ${order.orderId}`
                      : `Payment released for completed resale order ${order.orderId}`,
              },
            });
          }
        }

        // Update escrow statuses to RELEASED
        for (const escrow of escrows) {
          await tx.escrow.update({
            where: { id: escrow.id },
            data: {
              status: 'RELEASED',
              releasedAt: new Date(),
            },
          });
        }

        // Send notification to buyer
        await this.notificationService.createNotification({
          userId: user.id,
          title: 'Order Completed',
          message: `Your order ${order.orderId} has been completed and payment has been released to the listers.`,
          type: 'ORDER_COMPLETED',
          metadata: { orderId: order.id, orderNumber: order.orderId },
          sendEmail: true,
          emailData: {
            email: user.email,
            buyerName: user.name || 'Customer',
            orderId: order.orderId,
            totalAmount: order.totalAmountPaid,
            platformName: 'Relisted',
          },
        });

        // Emit notification event to buyer when escrow is released
        await this.eventEmitter.emit('order.escrow.released', {
          orderId: order.orderId,
          buyerId: user.id,
          buyerName: user.name,
          buyerEmail: user.email,
        });
      });

      return {
        success: true,
        message: 'Order confirmed and completed successfully',
        data: {
          orderId: order.orderId,
          status: 'COMPLETED',
        },
      };
    } catch (error) {
      console.error('Confirm order error:', error);
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to confirm order',
      );
    }
  }
}
