import { Injectable } from '@nestjs/common';
import { Order, Shipment, ShipmentType } from '@prisma/client';
import { selectOrderItemsForShipmentLeg } from '../../../module/shipment/order-items-for-shipment-leg';
import {
  TOPSHIP_DESCRIPTION_MAX_LEN,
  topshipCombinedOrderItemsDescription,
  topshipSanitizeDescription,
} from '../../topship/topship-description';
import {
  isTshipPricingTier,
  TshipAddressInput,
  TshipService,
  tshipCarrierSlugFromPricingTier,
} from '../../tship/tship.service';
import {
  DeliveryProvider,
  DispatchResult,
  TrackingLookupRef,
  TrackingStatus,
} from '../delivery-provider.interface';

@Injectable()
export class TshipProvider implements DeliveryProvider {
  constructor(private readonly tship: TshipService) {}

  private addressLine(addr: Record<string, unknown> | null | undefined): string {
    if (!addr) return '';
    return [addr.street, addr.city, addr.state, addr.country]
      .map((p) => (p != null ? String(p).trim() : ''))
      .filter(Boolean)
      .join(', ');
  }

  private toAddressInput(
    addr: Record<string, unknown>,
    fallbackName: string,
  ): TshipAddressInput {
    return {
      name: String(addr.name ?? fallbackName).trim() || fallbackName,
      email: String(addr.email ?? 'noreply@relisted.com').trim(),
      phone: String(addr.phone ?? '08000000000').trim(),
      line1: String(addr.street ?? this.addressLine(addr)).trim() || 'Lagos',
      city: String(addr.city ?? 'Lagos').trim(),
      state: String(addr.state ?? 'Lagos').trim(),
      country: String(addr.country ?? 'NG').trim() || 'NG',
      zip: addr.zip != null ? String(addr.zip).trim() : undefined,
    };
  }

  async dispatch(shipment: Shipment, order: Order): Promise<DispatchResult> {
    const s = shipment as Record<string, unknown>;
    const sender = s.pickupAddress as Record<string, unknown>;
    const receiver = s.deliveryAddress as Record<string, unknown>;
    const pickup = this.toAddressInput(sender, 'Sender');
    const delivery = this.toAddressInput(receiver, 'Recipient');

    const allOrderItems: any[] = (order as any).orderItems ?? [];
    const orderItems = selectOrderItemsForShipmentLeg(
      shipment.id,
      shipment.type as ShipmentType,
      allOrderItems,
    );
    const totalValueNgn = orderItems.reduce(
      (acc: number, i: any) =>
        acc + (i.product?.resalePrice || i.product?.originalValue || 0),
      0,
    );
    const productLines = topshipCombinedOrderItemsDescription(
      orderItems,
      TOPSHIP_DESCRIPTION_MAX_LEN,
    );
    const description = topshipSanitizeDescription(
      productLines || 'Relisted items',
      TOPSHIP_DESCRIPTION_MAX_LEN,
    );

    const pricingTier = String(s.pricingTier ?? '').trim();
    const preferredSlug = tshipCarrierSlugFromPricingTier(pricingTier);
    let rateId = String(s.pickupId ?? '').trim();

    if (!rateId || !isTshipPricingTier(pricingTier)) {
      const quote = await this.tship.fetchCheapestQuote(
        {
          pickup,
          delivery,
          parcel: {
            description,
            valueNgn: Math.max(1, Math.round(totalValueNgn || 1000)),
            itemName: description.slice(0, 40),
          },
          preferredCarrierSlug: preferredSlug || undefined,
        },
        { sameDayOnly: shipment.type !== 'RETURN' },
      );
      rateId = quote.rateId;
    }

    const raw = await this.tship.arrangePickup(rateId);
    const data = (raw as { data?: Record<string, unknown> })?.data ?? raw;
    const row =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    const shipmentId = String(row.shipment_id ?? '').trim();
    if (!shipmentId) {
      throw new Error(
        `Terminal did not return shipment_id: ${JSON.stringify(raw)}`,
      );
    }

    const extras = (row.extras ?? {}) as Record<string, unknown>;
    const trackingUrl =
      extras.tracking_url != null ? String(extras.tracking_url) : null;
    const trackingNumber =
      extras.tracking_number != null
        ? String(extras.tracking_number)
        : row.carrier_tracking_number != null
          ? String(row.carrier_tracking_number)
          : null;

    return {
      providerShipmentId: shipmentId,
      trackingId: trackingNumber || shipmentId,
      providerTrackingUrl: trackingUrl,
      rawResponse: raw,
    };
  }

  async getTrackingStatus(ref: TrackingLookupRef): Promise<TrackingStatus> {
    const shipmentId = String(ref.providerShipmentId ?? '').trim();
    if (!shipmentId) {
      return { status: 'UNKNOWN', updatedAt: new Date(), rawEvents: [] };
    }

    const raw = await this.tship.trackShipment(shipmentId);
    const data = (raw as { data?: Record<string, unknown> })?.data ?? raw;
    const row =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    const events = Array.isArray(row.events) ? row.events : [];
    const status = String(
      row.status ??
        (row.tracking_status as Record<string, unknown> | undefined)?.status ??
        'UNKNOWN',
    );

    const latest =
      events.length > 0
        ? events.reduce((acc: Record<string, unknown>, curr: unknown) => {
            const c =
              curr && typeof curr === 'object'
                ? (curr as Record<string, unknown>)
                : {};
            const a = acc?.created_at ? new Date(String(acc.created_at)) : null;
            const b = c.created_at ? new Date(String(c.created_at)) : null;
            if (!a) return c;
            if (!b) return acc;
            return b.getTime() >= a.getTime() ? c : acc;
          })
        : null;

    return {
      status,
      message:
        latest?.description != null ? String(latest.description) : undefined,
      location: latest?.location != null ? String(latest.location) : undefined,
      updatedAt: new Date(),
      providerShipmentStatus: status,
      rawEvents: events.length ? events : [row],
    };
  }

  async cancelShipment(providerShipmentId: string): Promise<void> {
    await this.tship.cancelShipment(providerShipmentId);
  }
}
