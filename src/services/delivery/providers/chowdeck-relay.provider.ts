import { Injectable } from '@nestjs/common';
import { Order, Shipment, ShipmentType } from '@prisma/client';
import { selectOrderItemsForShipmentLeg } from '../../../module/shipment/order-items-for-shipment-leg';
import {
  TOPSHIP_DESCRIPTION_MAX_LEN,
  topshipCombinedOrderItemsDescription,
  topshipSanitizeDescription,
} from '../../topship/topship-description';
import { ChowdeckRelayService } from '../../chowdeck-relay/chowdeck-relay.service';
import {
  DeliveryProvider,
  DispatchResult,
  TrackingLookupRef,
  TrackingStatus,
} from '../delivery-provider.interface';

@Injectable()
export class ChowdeckRelayProvider implements DeliveryProvider {
  constructor(private readonly relay: ChowdeckRelayService) {}

  private firstNonEmptyString(...vals: unknown[]): string | null {
    for (const v of vals) {
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  }

  private addressLine(addr: Record<string, any> | null | undefined): string {
    if (!addr) return '';
    return [addr.street, addr.city, addr.state, addr.country]
      .map((p) => (p != null ? String(p).trim() : ''))
      .filter(Boolean)
      .join(', ');
  }

  private relayReferenceForShipment(shipmentId: string): string {
    return `relisted-shp-${shipmentId}`;
  }

  async dispatch(shipment: Shipment, order: Order): Promise<DispatchResult> {
    const s = shipment as any;
    const sender = s.pickupAddress as Record<string, any>;
    const receiver = s.deliveryAddress as Record<string, any>;
    const sourceStr = this.addressLine(sender);
    const destStr = this.addressLine(receiver);
    if (!sourceStr || !destStr) {
      throw new Error('Chowdeck Relay requires pickup and delivery address strings');
    }

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
    const estimatedKobo = totalValueNgn ? Math.round(totalValueNgn * 100) : 0;

    const productLines = topshipCombinedOrderItemsDescription(
      orderItems,
      TOPSHIP_DESCRIPTION_MAX_LEN,
    );
    const description =
      orderItems.length > 0
        ? topshipSanitizeDescription(
            productLines,
            TOPSHIP_DESCRIPTION_MAX_LEN,
          )
        : topshipSanitizeDescription('Relisted items', TOPSHIP_DESCRIPTION_MAX_LEN);

    const reference = this.relayReferenceForShipment(shipment.id);

    const { feeId } = await this.relay.getDeliveryFee({
      sourceAddressString: sourceStr,
      destinationAddressString: destStr,
      estimatedOrderAmountKobo: estimatedKobo,
    });

    const body = {
      fee_id: feeId,
      reference,
      item_type: 'documents',
      user_action: 'sending',
      estimated_order_amount: estimatedKobo,
      customer_delivery_note: description.slice(0, 240),
      customer_vendor_note: 'Relisted rental or resale delivery',
      source_contact: {
        name: sender.name ?? 'Lister',
        phone: sender.phone ?? '08000000000',
        email: sender.email ?? undefined,
        country_code: 'NG',
      },
      destination_contact: {
        name: receiver.name ?? 'Recipient',
        phone: receiver.phone ?? '08000000000',
        email: receiver.email ?? undefined,
        country_code: 'NG',
      },
    };

    const raw = await this.relay.createDelivery(body);
    const data = (raw as any)?.data ?? raw;
    const refOut = this.firstNonEmptyString(
      data?.reference,
      reference,
    ) as string;
    const trackingUrl = this.firstNonEmptyString(data?.tracking_url, data?.trackingUrl);

    return {
      providerShipmentId: refOut,
      trackingId: refOut,
      providerTrackingUrl: trackingUrl,
      rawResponse: raw,
    };
  }

  async getTrackingStatus(ref: TrackingLookupRef): Promise<TrackingStatus> {
    const reference = this.firstNonEmptyString(
      ref.trackingId,
      ref.providerShipmentId,
    );
    if (!reference) {
      return { status: 'UNKNOWN', updatedAt: new Date(), rawEvents: [] };
    }
    const raw = await this.relay.getDeliveryByReference(reference);
    const data = (raw as any)?.data ?? raw;
    const row = (data && typeof data === 'object' ? data : {}) as Record<
      string,
      unknown
    >;
    const status = String(row.status ?? row.delivery_status ?? 'UNKNOWN');
    return {
      status,
      message: row.message != null ? String(row.message) : undefined,
      updatedAt: new Date(),
      rawEvents: [row],
    };
  }

  async cancelShipment(providerShipmentId: string): Promise<void> {
    await this.relay.cancelDelivery(
      providerShipmentId,
      'Cancelled via Relisted',
    );
  }
}
