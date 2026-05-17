import { Injectable } from '@nestjs/common';
import { Order, Shipment, ShipmentType } from '@prisma/client';
import { selectOrderItemsForShipmentLeg } from '../../../module/shipment/order-items-for-shipment-leg';
import {
  TOPSHIP_DESCRIPTION_MAX_LEN,
  topshipCombinedOrderItemsDescription,
  topshipSanitizeDescription,
} from '../../topship/topship-description';
import { formatShipbubbleAddressLine } from '../../shipbubble/shipbubble-address-normalize';
import {
  isShipbubblePricingTier,
  sanitizeShipbubbleContactName,
  sanitizeShipbubblePhone,
  ShipbubbleAddressContact,
  ShipbubbleService,
} from '../../shipbubble/shipbubble.service';
import {
  DeliveryProvider,
  DispatchResult,
  TrackingLookupRef,
  TrackingStatus,
} from '../delivery-provider.interface';

@Injectable()
export class ShipbubbleProvider implements DeliveryProvider {
  constructor(private readonly shipbubble: ShipbubbleService) {}

  private addressLine(addr: Record<string, any> | null | undefined): string {
    if (!addr) return '';
    return formatShipbubbleAddressLine({
      street: addr.street,
      city: addr.city,
      state: addr.state,
      country: addr.country,
    });
  }

  private toContact(
    addr: Record<string, any>,
    fallbackName: string,
  ): ShipbubbleAddressContact {
    return {
      name: sanitizeShipbubbleContactName(
        String(addr.name ?? fallbackName),
        sanitizeShipbubbleContactName(fallbackName, 'Relisted Customer'),
      ),
      email: String(addr.email ?? 'noreply@relisted.com').trim(),
      phone: sanitizeShipbubblePhone(String(addr.phone ?? '')),
      addressLine: this.addressLine(addr),
    };
  }

  private packageLinesFromOrder(
    shipment: Shipment,
    order: Order,
  ): Array<{ name: string; valueNgn: number }> {
    const allOrderItems: any[] = (order as any).orderItems ?? [];
    const orderItems = selectOrderItemsForShipmentLeg(
      shipment.id,
      shipment.type as ShipmentType,
      allOrderItems,
    );
    if (!orderItems.length) {
      return [{ name: 'Relisted items', valueNgn: 1000 }];
    }
    return orderItems.map((i: any) => ({
      name: String(i.product?.name ?? 'Item').slice(0, 80),
      valueNgn: Number(
        i.product?.resalePrice || i.product?.originalValue || 1000,
      ),
    }));
  }

  async dispatch(shipment: Shipment, order: Order): Promise<DispatchResult> {
    const s = shipment as any;
    const sender = s.pickupAddress as Record<string, any>;
    const receiver = s.deliveryAddress as Record<string, any>;
    const senderContact = this.toContact(sender, 'Sender');
    const receiverContact = this.toContact(receiver, 'Recipient');
    if (!senderContact.addressLine || !receiverContact.addressLine) {
      throw new Error(
        'Shipbubble requires pickup and delivery address strings with city and state',
      );
    }

    const allOrderItems: any[] = (order as any).orderItems ?? [];
    const orderItems = selectOrderItemsForShipmentLeg(
      shipment.id,
      shipment.type as ShipmentType,
      allOrderItems,
    );
    const productLines = topshipCombinedOrderItemsDescription(
      orderItems,
      TOPSHIP_DESCRIPTION_MAX_LEN,
    );
    const description = topshipSanitizeDescription(
      productLines || 'Relisted items',
      TOPSHIP_DESCRIPTION_MAX_LEN,
    );

    const packageItems = this.shipbubble.buildDefaultPackageItems(
      this.packageLinesFromOrder(shipment, order).map((line) => ({
        ...line,
        name: line.name || description.slice(0, 40),
      })),
    );
    const scheduledWindowStart = s.scheduledWindowStart
      ? new Date(s.scheduledWindowStart)
      : null;

    const storedRequestToken = String(s.pickupId ?? '').trim();
    const storedCourierId = String(s.pickupPartner ?? '').trim();
    const pricingTier = String(s.pricingTier ?? '').trim().toLowerCase();
    let requestToken = storedRequestToken;
    let serviceCode = '';
    let courierId = storedCourierId;

    if (pricingTier.startsWith('shipbubble:')) {
      serviceCode = pricingTier.slice('shipbubble:'.length);
    }

    if (
      !requestToken ||
      !courierId ||
      !serviceCode ||
      !isShipbubblePricingTier(pricingTier)
    ) {
      const quote = await this.shipbubble.fetchCheapestPickupQuote(
        {
          sender: senderContact,
          receiver: receiverContact,
          packageItems,
          scheduledWindowStart,
        },
        { sameDayOnly: shipment.type !== 'RETURN' },
      );
      requestToken = quote.requestToken;
      serviceCode = quote.serviceCode;
      courierId = quote.courierId;
    }

    const raw = await this.shipbubble.createLabel({
      requestToken,
      serviceCode,
      courierId,
    });

    const data = (raw as any)?.data ?? raw;
    const orderId = String(data?.order_id ?? '').trim();
    if (!orderId) {
      throw new Error(
        `Shipbubble did not return order_id: ${JSON.stringify(raw)}`,
      );
    }

    const trackingUrl =
      data?.tracking_url != null ? String(data.tracking_url) : null;
    const trackingCode =
      data?.courier?.tracking_code != null
        ? String(data.courier.tracking_code)
        : null;

    return {
      providerShipmentId: orderId,
      trackingId: trackingCode || orderId,
      providerTrackingUrl: trackingUrl,
      rawResponse: raw,
    };
  }

  async getTrackingStatus(ref: TrackingLookupRef): Promise<TrackingStatus> {
    const orderId = String(ref.providerShipmentId ?? ref.trackingId ?? '').trim();
    if (!orderId) {
      return { status: 'UNKNOWN', updatedAt: new Date(), rawEvents: [] };
    }

    const raw = await this.shipbubble.getShipmentByOrderId(orderId);
    const row = this.extractShipmentRowFromLabelsListResponse(raw);
    if (!row) {
      return { status: 'UNKNOWN', updatedAt: new Date(), rawEvents: [raw] };
    }

    const status = String((row as any).status ?? 'UNKNOWN');
    const events = Array.isArray((row as any).events) ? (row as any).events : [];
    return {
      status,
      message:
        (row as any).courier?.tracking_message != null
          ? String((row as any).courier.tracking_message)
          : undefined,
      updatedAt: new Date(),
      providerShipmentStatus: status,
      rawEvents: events.length ? events : [row],
    };
  }

  async cancelShipment(providerShipmentId: string): Promise<void> {
    await this.shipbubble.cancelLabel(providerShipmentId);
  }

  /**
   * GET /shipping/labels/list/:order_ids returns `data` as an array of shipments.
   * Some doc examples use `data.results`; accept both shapes.
   */
  private extractShipmentRowFromLabelsListResponse(
    raw: unknown,
  ): Record<string, unknown> | null {
    const data = (raw as { data?: unknown })?.data;
    if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
      return data[0] as Record<string, unknown>;
    }
    const results = (data as { results?: unknown })?.results;
    if (Array.isArray(results) && results[0] && typeof results[0] === 'object') {
      return results[0] as Record<string, unknown>;
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return null;
  }
}
