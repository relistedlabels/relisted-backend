import { Injectable } from '@nestjs/common';
import { Order, Shipment, ShipmentType } from '@prisma/client';
import { selectOrderItemsForShipmentLeg } from '../../../module/shipment/order-items-for-shipment-leg';
import {
  TOPSHIP_DESCRIPTION_MAX_LEN,
  topshipCombinedOrderItemsDescription,
} from '../../topship/topship-description';
import { TopshipService } from '../../topship/topship.service';
import {
  DeliveryProvider,
  DispatchResult,
  TrackingLookupRef,
  TrackingStatus,
} from '../delivery-provider.interface';

type TopshipPaymentError = Error & {
  providerShipmentId?: string;
  trackingId?: string | null;
};

@Injectable()
export class TopshipProvider implements DeliveryProvider {
  constructor(private readonly topship: TopshipService) {}

  /** Topship save-shipment GraphQL expects PricingTierType enum casing (e.g. Chowdeck). */
  private toPricingTierEnum(tier: string | null | undefined): string {
    const t = String(tier ?? '').trim().toLowerCase();
    if (!t || t === 'budget' || t === 'standard') return 'Chowdeck';
    if (t === 'chowdeck') return 'Chowdeck';
    if (t === 'glovo') return 'Glovo';
    const raw = String(tier ?? '').trim();
    if (/^[A-Z][a-zA-Z0-9]*$/.test(raw)) return raw;
    return 'Chowdeck';
  }

  private formatReceiverDeliveryLine(receiver: Record<string, any>): string {
    return [receiver.street, receiver.city, receiver.state]
      .map((p) => (p != null ? String(p).trim() : ''))
      .filter(Boolean)
      .join(', ');
  }

  private firstNonEmptyString(...vals: unknown[]): string | null {
    for (const v of vals) {
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  }

  async dispatch(shipment: Shipment, order: Order): Promise<DispatchResult> {
    const existingProviderShipmentId = this.firstNonEmptyString(
      (shipment as any)?.providerShipmentId,
    );

    let providerShipmentId = existingProviderShipmentId;
    let draftTrackingId: string | null = this.firstNonEmptyString(
      (shipment as any)?.trackingId,
    );
    if (!providerShipmentId) {
      const payload = this.buildPayload(shipment, order);
      const draftResponse = await this.topship.bookShipmentAsDraft(payload);
      const data = draftResponse?.[0] ?? draftResponse?.data?.[0];
      providerShipmentId = this.firstNonEmptyString(data?.id, data?.shipmentId);
      if (!providerShipmentId) {
        throw new Error(
          `Topship did not return a shipment ID. Raw response: ${JSON.stringify(draftResponse)}`,
        );
      }
      draftTrackingId = this.firstNonEmptyString(
        data?.trackingId,
        data?.trackingNumber,
      );
    }

    let paid: any;
    try {
      paid = await this.topship.payForShipment(providerShipmentId);
    } catch (err: any) {
      const wrapped = new Error(err?.message ?? 'Topship payment failed');
      (wrapped as TopshipPaymentError).providerShipmentId = providerShipmentId;
      (wrapped as TopshipPaymentError).trackingId = draftTrackingId;
      throw wrapped;
    }

    const payRow =
      paid && typeof paid === 'object'
        ? Array.isArray(paid)
          ? (paid[0] ?? {})
          : (paid as any)?.data?.[0] ?? paid
        : {};

    const trackingId = this.firstNonEmptyString(
      draftTrackingId,
      payRow.trackingId,
      payRow.trackingNumber,
    );

    return {
      providerShipmentId,
      trackingId,
      providerTrackingUrl: 'https://ship.topship.africa/tracking',
      rawResponse: payRow,
    };
  }

  /**
   * Topship `GET /track-shipment` expects the public tracking reference.
   * When we only have the internal save-shipment id, use `GET /get-shipment/:id` instead.
   */
  async getTrackingStatus(ref: TrackingLookupRef): Promise<TrackingStatus> {
    const tid = this.firstNonEmptyString(ref.trackingId);
    if (tid) {
      const raw = await this.topship.trackShipment(tid);
      return this.parseTrackShipmentResponse(raw);
    }

    const detail = await this.topship.getShipmentById(ref.providerShipmentId);
    return this.parseGetShipmentResponse(detail);
  }

  private parseTrackShipmentResponse(raw: any): TrackingStatus {
    const events: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : raw
          ? [raw]
          : [];

    if (events.length === 0) {
      return { status: 'UNKNOWN', updatedAt: new Date(), rawEvents: [] };
    }

    const latest = events.reduce((acc: any, curr: any) => {
      const accDate = acc?.updatedDate || acc?.createdDate;
      const currDate = curr?.updatedDate || curr?.createdDate;
      if (!accDate) return curr;
      if (!currDate) return acc;
      return new Date(currDate).getTime() >= new Date(accDate).getTime()
        ? curr
        : acc;
    });

    const status =
      latest?.status || latest?.shipment?.shipmentStatus || 'UNKNOWN';

    return {
      status,
      location: latest?.itemLocation ?? undefined,
      message: latest?.message ?? undefined,
      providerShipmentStatus: latest?.shipment?.shipmentStatus ?? undefined,
      updatedAt: latest?.updatedDate
        ? new Date(latest.updatedDate)
        : latest?.createdDate
          ? new Date(latest.createdDate)
          : new Date(),
      rawEvents: events,
    };
  }

  private parseGetShipmentResponse(detail: any): TrackingStatus {
    const row =
      detail?.data?.shipment ??
      detail?.shipment ??
      detail?.data ??
      detail?.[0] ??
      detail ??
      {};
    const status =
      row.shipmentStatus ??
      row.status ??
      row.shipment?.shipmentStatus ??
      'UNKNOWN';
    return {
      status: String(status),
      location: row.itemLocation ?? undefined,
      message: row.message ?? undefined,
      providerShipmentStatus: row.shipmentStatus ?? undefined,
      updatedAt: new Date(),
      rawEvents: row && Object.keys(row).length ? [row] : [],
    };
  }

  async cancelShipment(providerShipmentId: string): Promise<void> {
    await this.topship.cancelShipment(providerShipmentId);
  }

  /**
   * Builds the Topship API payload from the address snapshots stored on the Shipment
   * record at order-creation time. This means dispatch day never needs to re-query
   * profiles — all data is self-contained in the Shipment record.
   */
  private buildPayload(shipment: Shipment, order: Order & { orderItems?: any[] }) {
    const s = shipment as any;
    const sender = s.pickupAddress as any;
    const receiver = s.deliveryAddress as any;

    const allOrderItems: any[] = (order as any).orderItems ?? [];
    const orderItems = selectOrderItemsForShipmentLeg(
      shipment.id,
      shipment.type as ShipmentType,
      allOrderItems,
    );
    const itemCount = orderItems.length || 1;
    const totalValue = orderItems.reduce(
      (acc: number, i: any) =>
        acc + (i.product?.resalePrice || i.product?.originalValue || 0),
      0,
    );

    const description = topshipCombinedOrderItemsDescription(
      orderItems,
      TOPSHIP_DESCRIPTION_MAX_LEN,
      `Relisted ${s.type} ${order.orderId ?? order.id}`,
    );

    // Relisted `scheduledWindowStart` / `scheduledWindowEnd` are internal: they drive when
    // we enqueue dispatch (cron), not a contract we forward to Topship. Their GraphQL input
    // only exposes `pickupDate`, so we send a single nominal ISO time (window start, else day).
    const pickupSchedule: { pickupDate?: string } = {};
    if (s.scheduledWindowStart) {
      pickupSchedule.pickupDate = new Date(
        s.scheduledWindowStart,
      ).toISOString();
    } else if (s.scheduledDate) {
      pickupSchedule.pickupDate = new Date(s.scheduledDate).toISOString();
    }

    return {
      shipment: [
        {
          senderDetail: {
            name: sender.name ?? 'Lister',
            phoneNumber: sender.phone ?? '08000000000',
            email: sender.email ?? 'lister@relisted.com',
            city: sender.city ?? 'Lagos',
            state: sender.state ?? 'Lagos',
            countryCode: 'NG',
            addressLine1: sender.street ?? 'Lagos, Nigeria',
            country: 'Nigeria',
            postalCode: sender.zip || undefined,
          },
          receiverDetail: {
            name: receiver.name ?? 'Renter',
            phoneNumber: receiver.phone ?? '08000000000',
            email: receiver.email ?? 'renter@relisted.com',
            city: receiver.city ?? 'Lagos',
            state: receiver.state ?? 'Lagos',
            countryCode: 'NG',
            addressLine1: receiver.street ?? 'Lagos, Nigeria',
            country: 'Nigeria',
            postalCode: receiver.zip || undefined,
          },
          pricingTier: this.toPricingTierEnum(s.pricingTier),
          insuranceType: 'None',
          itemCollectionMode: 'PickUp',
          shipmentRoute: 'Domestic',
          insuranceCharge: 0,
          shipmentCharge: s.shipmentCharge ?? 0,
          pickupId: s.pickupId || `PICKUP-${shipment.id}`,
          pickupPartner: this.toPricingTierEnum(
            s.pickupPartner ?? s.pricingTier,
          ),
          pickupCharge: s.pickupCharge ?? 0,
          valueAddedTaxCharge: s.vatCharge ?? 0,
          discount: 0,
          deliveryLocation:
            this.formatReceiverDeliveryLine(receiver) ||
            (s.deliveryLocation as string) ||
            receiver.street ||
            'Lagos, Nigeria',
          ...pickupSchedule,
          items: [
            {
              category: 'ClothingAndTextile',
              description,
              weight: 1,
              quantity: itemCount,
              // Topship expects value in kobo; fallback to ₦10k if product pricing is missing
              value: totalValue ? totalValue * 100 : 1000000,
            },
          ],
        },
      ],
    };
  }
}
