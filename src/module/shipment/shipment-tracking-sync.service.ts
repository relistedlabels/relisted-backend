import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { TrackingStatus } from 'src/services/delivery/delivery-provider.interface';
import { isShipbubblePricingTier } from 'src/services/shipbubble/shipbubble.service';
import { syncOrderStatusFromShipments } from 'src/module/order/order-shipment-status.sync';
import { fetchAdminAlertRecipients } from 'src/module/shipment/shipment-admin-alert-recipients';
import { buildAdminShipmentsPageUrl } from 'src/module/shipment/build-admin-shipments-page-url';
import { sendShipmentLegStatusNotification } from './shipment-status-notifications';
import {
  buildShippingEmailTrackingFields,
  getShippingProviderDisplayName,
  resolveShipmentFulfillmentProvider,
} from './shipment-tracking-url.util';
import {
  canAdvanceShipmentStatus,
  mapProviderStatusToShipmentStatus,
  type ShipmentLifecycleStatus,
} from './shipment-provider-status';

export type ShipmentTrackingPollRow = {
  id: string;
  listerId: string | null;
  providerShipmentId: string | null;
  trackingId: string | null;
  status: string;
  type: string;
  pricingTier: string | null;
  providerTrackingUrl?: string | null;
  order: {
    id: string;
    orderId: string;
    user: { id: string; name: string | null; email: string | null };
  };
};

export type ApplyProviderTrackingResult = {
  updated: boolean;
  skippedReason?: string;
  mappedStatus?: ShipmentLifecycleStatus;
};

@Injectable()
export class ShipmentTrackingSyncService {
  private readonly logger = new Logger(ShipmentTrackingSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    private readonly mail: MailService,
  ) {}

  /**
   * Shared handler for cron polling and Shipbubble webhooks.
   * Forward-only status updates; duplicate or stale events are ignored.
   */
  async applyProviderTrackingUpdate(input: {
    shipment: ShipmentTrackingPollRow;
    providerStatus: string;
    source: 'poll' | 'webhook';
    tracking?: Pick<TrackingStatus, 'status' | 'message'>;
    trackingId?: string | null;
    providerTrackingUrl?: string | null;
    forceCancelled?: boolean;
  }): Promise<ApplyProviderTrackingResult> {
    const logPrefix =
      input.source === 'webhook' ? '[ShipbubbleWebhook]' : '[Polling]';
    const shipment = input.shipment;

    await this.mergeTrackingMetadata(shipment.id, {
      trackingId: input.trackingId,
      providerTrackingUrl: input.providerTrackingUrl,
    });

    if (input.forceCancelled) {
      return this.applyCancelled(
        shipment,
        input.providerStatus,
        input.tracking,
        logPrefix,
      );
    }

    const mappedStatus = mapProviderStatusToShipmentStatus(
      input.providerStatus,
      shipment.pricingTier,
    );

    if (mappedStatus === undefined) {
      this.logger.warn(
        `${logPrefix} Shipment ${shipment.id} unknown provider status '${input.providerStatus}'. Skipping.`,
      );
      return { updated: false, skippedReason: 'unknown_status' };
    }

    if (mappedStatus === null) {
      this.logger.debug(
        `${logPrefix} Shipment ${shipment.id} status '${input.providerStatus}' does not change local state.`,
      );
      return { updated: false, skippedReason: 'no_op_status' };
    }

    if (mappedStatus === 'CANCELLED') {
      return this.applyCancelled(
        shipment,
        input.providerStatus,
        input.tracking,
        logPrefix,
      );
    }

    if (!canAdvanceShipmentStatus(shipment.status, mappedStatus)) {
      this.logger.debug(
        `${logPrefix} Shipment ${shipment.id} would not advance (${shipment.status} → ${mappedStatus})`,
      );
      return {
        updated: false,
        skippedReason: 'no_advance',
        mappedStatus,
      };
    }

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: mappedStatus },
    });

    this.logger.log(
      `${logPrefix} Shipment ${shipment.id}: ${shipment.status} → ${mappedStatus}`,
    );

    try {
      await syncOrderStatusFromShipments(this.prisma, shipment.order.id);
    } catch (syncErr: unknown) {
      const msg =
        syncErr instanceof Error ? syncErr.message : String(syncErr);
      this.logger.warn(
        `${logPrefix} Order status sync failed for order ${shipment.order.id}: ${msg}`,
      );
    }

    const shipmentForNotify: ShipmentTrackingPollRow = {
      ...shipment,
      trackingId:
        input.trackingId?.trim() || shipment.trackingId,
      providerTrackingUrl:
        input.providerTrackingUrl?.trim() || shipment.providerTrackingUrl,
    };
    await this.sendTrackingNotification(shipmentForNotify, mappedStatus);

    return { updated: true, mappedStatus };
  }

  async findShipbubbleShipmentByProviderOrderId(
    providerOrderId: string,
  ): Promise<ShipmentTrackingPollRow | null> {
    const id = String(providerOrderId ?? '').trim();
    if (!id) return null;

    const shipment = await this.prisma.shipment.findFirst({
      where: { providerShipmentId: id },
      select: {
        id: true,
        listerId: true,
        providerShipmentId: true,
        trackingId: true,
        status: true,
        type: true,
        pricingTier: true,
        providerTrackingUrl: true,
        order: {
          select: {
            id: true,
            orderId: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!shipment || !isShipbubblePricingTier(shipment.pricingTier)) {
      return null;
    }

    return shipment;
  }

  private async mergeTrackingMetadata(
    shipmentId: string,
    meta: {
      trackingId?: string | null;
      providerTrackingUrl?: string | null;
    },
  ): Promise<void> {
    const data: Record<string, string> = {};
    const trackingId = meta.trackingId?.trim();
    const trackingUrl = meta.providerTrackingUrl?.trim();
    if (trackingId) data.trackingId = trackingId;
    if (trackingUrl) data.providerTrackingUrl = trackingUrl;
    if (!Object.keys(data).length) return;

    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data,
    });
  }

  private async applyCancelled(
    shipment: ShipmentTrackingPollRow,
    providerStatus: string,
    tracking: Pick<TrackingStatus, 'status' | 'message'> | undefined,
    logPrefix: string,
  ): Promise<ApplyProviderTrackingResult> {
    if (shipment.status === 'CANCELLED' || shipment.status === 'COMPLETED') {
      return { updated: false, skippedReason: 'already_terminal' };
    }

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: 'CANCELLED' },
    });

    this.logger.warn(
      `${logPrefix} Shipment ${shipment.id} marked CANCELLED (provider: ${providerStatus}).`,
    );

    await this.notifyAdminOfProviderCancellation(shipment, {
      status: providerStatus,
      message: tracking?.message,
    });

    return { updated: true, mappedStatus: 'CANCELLED' };
  }

  private async sendTrackingNotification(
    shipment: ShipmentTrackingPollRow,
    newStatus: string,
  ): Promise<void> {
    const isReturn = shipment.type === 'RETURN';

    await sendShipmentLegStatusNotification(
      this.notification,
      shipment as any,
      newStatus,
    );

    if (newStatus === 'IN_TRANSIT' && isReturn) {
      await this.notifyListersForReturnLeg(shipment, 'IN_TRANSIT');
    }
    if (newStatus === 'COMPLETED' && isReturn) {
      await this.notifyListersForReturnLeg(shipment, 'COMPLETED');
    }
  }

  private async notifyListersForReturnLeg(
    shipment: ShipmentTrackingPollRow,
    phase: 'IN_TRANSIT' | 'COMPLETED',
  ): Promise<void> {
    const orderInternalId = shipment.order?.id;
    if (!orderInternalId) return;

    const full = await this.prisma.order.findUnique({
      where: { id: orderInternalId },
      select: {
        id: true,
        orderId: true,
        orderItems: {
          select: {
            product: {
              select: {
                curator: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    profile: {
                      select: {
                        businessInfo: { select: { businessName: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!full) return;

    const clientUrl = process.env.CLIENT_URL || 'https://relisted.com';
    const orderPageUrl = `${clientUrl}/listers/orders/${full.id}`;
    const trackingFields = buildShippingEmailTrackingFields(shipment);

    const listerId = shipment.listerId;
    if (!listerId) return;

    const lister = full.orderItems
      .map((oi) => oi.product?.curator)
      .find((c) => c?.id === listerId);
    if (!lister?.email?.trim()) return;

    const curatorName =
      lister.profile?.businessInfo?.businessName || lister.name || 'there';

    if (phase === 'IN_TRANSIT') {
      await this.notification.createNotification({
        userId: listerId,
        title: 'Return on its way to you',
        message: `The renter's return for order ${full.orderId} is in transit to your address.`,
        type: 'LISTER_RETURN_IN_TRANSIT',
        metadata: {
          orderId: full.id,
          orderNumber: full.orderId,
          shipmentId: shipment.id,
        },
        sendEmail: true,
        emailData: {
          email: lister.email.trim(),
          curatorName,
          orderNumber: full.orderId,
          orderPageUrl,
          platformName: 'Relisted',
          ...trackingFields,
        },
      });
    } else {
      await this.notification.createNotification({
        userId: listerId,
        title: 'Confirm return receipt to finish this rental',
        message: `Tracking shows the return for order ${full.orderId} was delivered. Open your order, review the renter's condition report, then confirm return receipt. That completes the order: collateral goes back to the renter and your rental earnings plus cleaning fee are released to your wallet.`,
        type: 'LISTER_RETURN_DELIVERED_CONFIRM',
        metadata: {
          orderId: full.id,
          orderNumber: full.orderId,
          shipmentId: shipment.id,
        },
        sendEmail: true,
        emailData: {
          email: lister.email.trim(),
          curatorName,
          orderNumber: full.orderId,
          orderPageUrl,
          platformName: 'Relisted',
          trackingNumber: trackingFields.trackingNumber,
        },
      });
    }
  }

  private async notifyAdminOfProviderCancellation(
    shipment: ShipmentTrackingPollRow,
    tracking: { status?: string; message?: string },
  ): Promise<void> {
    const providerStatus = tracking.status || 'Cancelled';
    const order = shipment.order;
    const providerLabel = getShippingProviderDisplayName(
      resolveShipmentFulfillmentProvider(shipment.pricingTier),
    );

    const admins = await fetchAdminAlertRecipients(this.prisma);
    if (admins.length === 0) {
      this.logger.warn(
        `No admin users found for shipment cancellation alert (shipment ${shipment.id}).`,
      );
      return;
    }

    const adminShipmentUrl =
      buildAdminShipmentsPageUrl({ shipmentId: shipment.id }) || undefined;

    for (const admin of admins) {
      await this.notification.createNotification({
        userId: admin.id,
        title: `Shipment cancelled by ${providerLabel}`,
        message: `Shipment ${shipment.id} (${shipment.type}) was cancelled by ${providerLabel} (status: ${providerStatus}).`,
        type: 'SHIPMENT_PROVIDER_CANCELLED',
        metadata: {
          shipmentId: shipment.id,
          orderId: order?.orderId ?? shipment.id,
          providerStatus,
          providerMessage: tracking.message ?? null,
        },
      });
    }

    for (const admin of admins) {
      if (!admin.email?.trim()) continue;
      try {
        await this.mail.sendAdminShipmentCancelledAlert({
          to: admin.email.trim(),
          shipmentId: shipment.id,
          orderId: order?.orderId ?? shipment.id,
          shipmentType: shipment.type,
          providerStatus,
          providerMessage: tracking.message,
          providerLabel,
          trackingUrl:
            shipment.providerTrackingUrl ??
            buildShippingEmailTrackingFields(shipment).trackingUrl,
          adminShipmentUrl,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to send admin cancellation email to ${admin.email} for shipment ${shipment.id}: ${msg}`,
        );
      }
    }
  }
}
