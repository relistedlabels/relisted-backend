import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { DeliveryProviderService } from 'src/services/delivery/delivery-provider.service';
import { TrackingStatus } from 'src/services/delivery/delivery-provider.interface';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { syncOrderStatusFromShipments } from 'src/module/order/order-shipment-status.sync';
import { addMinutes, startOfDay, subMinutes } from 'date-fns';
import { fetchAdminAlertRecipients } from 'src/module/shipment/shipment-admin-alert-recipients';

const normalizeProviderStatus = (status: string) =>
  status.toLowerCase().replace(/[^a-z]/g, '');

const DISPATCH_CRON_LOOKAHEAD_MINUTES = Number(
  process.env.DISPATCH_CRON_LOOKAHEAD_MINUTES ?? 60,
);

@Injectable()
export class ShipmentDispatchScheduler {
  private readonly logger = new Logger(ShipmentDispatchScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shipment-dispatch') private readonly queue: Queue,
    private readonly delivery: DeliveryProviderService,
    private readonly notification: NotificationService,
    private readonly mail: MailService,
  ) {}

  /**
   * Runs on the configured cadence (defaults to hourly) in Africa/Lagos time.
   * Scans for pending shipments whose dispatch window starts within the lookahead
   * horizon (defaults to 60 minutes) and locks + enqueues each one exactly once.
   * `scheduledWindowStart` / `scheduledWindowEnd` are Relisted-only; the worker maps
   * them to Topship’s single `pickupDate` when booking, not as partner-facing windows.
   */
  @Cron(process.env.DISPATCH_CRON || '0 * * * *', { timeZone: 'Africa/Lagos' })
  async dispatchDueShipments() {
    const now = new Date();
    const today = startOfDay(now);
    const lookaheadCutoff = addMinutes(now, DISPATCH_CRON_LOOKAHEAD_MINUTES);
    this.logger.log(
      `[Cron] Running dispatch window scan. Now=${now.toISOString()}, lookahead=${lookaheadCutoff.toISOString()}`,
    );

    const due = await this.prisma.shipment.findMany({
      where: {
        status: 'PENDING',
        OR: [
          {
            scheduledWindowStart: {
              lte: lookaheadCutoff,
            },
          },
          {
            scheduledWindowStart: null,
            scheduledDate: { lte: today },
          },
        ],
      },
      select: { id: true },
    });

    this.logger.log(`[Cron] Found ${due.length} shipment(s) due today`);

    let enqueued = 0;
    for (const { id } of due) {
      // Atomic lock: only proceed if we win the status race
      const locked = await this.prisma.shipment.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'DISPATCHING' },
      });

      if (locked.count === 0) {
        this.logger.warn(
          `[Cron] Shipment ${id} already locked by another process — skipping`,
        );
        continue;
      }

      await this.queue.add('dispatch', { shipmentId: id }, { attempts: 1 });
      enqueued++;
    }

    this.logger.log(`[Cron] Enqueued ${enqueued} dispatch job(s)`);
  }

  /**
   * Stale-lock recovery: runs every 30 minutes.
   * Any shipment stuck in DISPATCHING for more than 30 minutes is reset to PENDING
   * so the next cron cycle (or a manual redispatch) can pick it up.
   */
  @Cron('*/30 * * * *')
  async recoverStaleDispatching() {
    const threshold = subMinutes(new Date(), 30);

    const result = await this.prisma.shipment.updateMany({
      where: { status: 'DISPATCHING', updatedAt: { lt: threshold } },
      data: { status: 'PENDING' },
    });

    if (result.count > 0) {
      this.logger.warn(
        `[StaleLock] Reset ${result.count} shipment(s) from DISPATCHING → PENDING`,
      );
    }
  }

  /**
   * Polls Topship for tracking status updates every 2 hours.
   * Only checks shipments that are DISPATCHED or IN_TRANSIT (not COMPLETED/CANCELLED/FAILED).
   * Updates local status based on provider response and triggers notifications.
   */
  @Cron(process.env.POLLING_CRON || '*/10 * * * *', { timeZone: 'Africa/Lagos' })
  async pollTrackingStatus() {
    this.logger.log(`[Polling] Starting tracking status poll`);

    const candidateCount = await this.prisma.shipment.count({
      where: { status: { in: ['DISPATCHED', 'IN_TRANSIT'] } },
    });
    this.logger.log(
      `[Polling] ${candidateCount} shipment(s) currently in DISPATCHED/IN_TRANSIT (before provider filter)`,
    );

    // Find shipments that need tracking updates
    const shipments = await this.prisma.shipment.findMany({
      where: {
        status: { in: ['DISPATCHED', 'IN_TRANSIT'] },
        providerShipmentId: { not: null },
      },
      select: {
        id: true,
        providerShipmentId: true,
        trackingId: true,
        status: true,
        type: true,
        order: {
          select: {
            id: true,
            orderId: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    this.logger.log(`[Polling] Found ${shipments.length} shipment(s) to poll`);

    let updated = 0;
    for (const shipment of shipments) {
      try {
        this.logger.log(
          `[Polling] Checking shipment ${shipment.id} (providerShipmentId=${shipment.providerShipmentId}, trackingId=${shipment.trackingId ?? 'none'}, currentStatus=${shipment.status})`,
        );
        const provider = this.delivery.forShipment(shipment as any);
        const tracking = await provider.getTrackingStatus({
          providerShipmentId: shipment.providerShipmentId!,
          trackingId: shipment.trackingId,
        });

        const providerStatus = (tracking.status || 'UNKNOWN').trim();
        this.logger.log(
          `[Polling] Topship returned status for shipment ${shipment.id}: ${providerStatus}, message=${tracking.message ?? 'n/a'}`,
        );

        const statusMap: Record<string, 'DISPATCHED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED' | null> = {
          pickedup: 'IN_TRANSIT',
          intransit: 'IN_TRANSIT',
          delivered: 'COMPLETED',
          received: 'COMPLETED',
          confirmed: 'DISPATCHED',
          draft: null,
          cancelled: 'CANCELLED',
          awaitingpickup: 'DISPATCHED',
          awaitingpickuppending: 'DISPATCHED',
          awaitingdropoff: 'DISPATCHED',
          deliveryinprogress: 'IN_TRANSIT',
          assignedfordelivery: 'IN_TRANSIT',
          pendingconfirmation: null,
          clarificationneeded: null,
          receivedathub: 'IN_TRANSIT',
          arrivednigeria: 'IN_TRANSIT',
          pickupinprogress: 'IN_TRANSIT',
          shipmentprocessing: 'DISPATCHED',
          deliveryfailed: 'CANCELLED',
          cancellationpending: 'CANCELLED',
          paymentpending: null,
          pickupfailed: 'CANCELLED',
          riderassigned: 'IN_TRANSIT',
        };

        const normalizedStatus = normalizeProviderStatus(providerStatus);
        const mappedStatus = statusMap[normalizedStatus];

        if (mappedStatus === undefined) {
          this.logger.warn(
            `[Polling] Shipment ${shipment.id} received unknown status '${providerStatus}'. Skipping update.`,
          );
          continue;
        }

        if (mappedStatus === null) {
          this.logger.debug(
            `[Polling] Shipment ${shipment.id} status '${providerStatus}' does not change local state.`,
          );
          continue;
        }

        if (mappedStatus === 'CANCELLED') {
          await this.prisma.shipment.update({
            where: { id: shipment.id },
            data: { status: 'CANCELLED' },
          });
          this.logger.warn(
            `[Polling] Shipment ${shipment.id} marked CANCELLED based on provider status.`,
          );
          await this.notifyAdminOfProviderCancellation(
            shipment as any,
            tracking,
          );
          updated++;
          continue;
        }

        // Idempotency: do not move backwards or stay the same
        const statusOrder = ['DISPATCHED', 'IN_TRANSIT', 'COMPLETED'];
        const currentIndex = statusOrder.indexOf(shipment.status as any);
        const newIndex = statusOrder.indexOf(mappedStatus);

        if (newIndex <= currentIndex) {
          this.logger.debug(
            `[Polling] Shipment ${shipment.id} would not advance status (${shipment.status} → ${mappedStatus})`,
          );
          continue;
        }

        // Update status
        await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: { status: mappedStatus },
        });

        this.logger.log(
          `[Polling] ✅ Updated shipment ${shipment.id}: ${shipment.status} → ${mappedStatus}`,
        );
        updated++;

        try {
          await syncOrderStatusFromShipments(
            this.prisma,
            shipment.order.id,
          );
        } catch (syncErr: any) {
          this.logger.warn(
            `[Polling] Order status sync failed for order ${shipment.order.id}: ${syncErr?.message ?? syncErr}`,
          );
        }

        // Send notification
        await this.sendTrackingNotification(shipment as any, mappedStatus);
      } catch (err: any) {
        this.logger.error(
          `[Polling] Failed to poll shipment ${shipment.id}: ${err.message}`,
        );
        // Never move DISPATCHED / IN_TRANSIT → DISPATCH_FAILED from polling alone.
        // A bad id, staging/prod mismatch, or transient Topship error is not the same
        // as our dispatch worker failing; status changes here are forward-only (above).
        if (
          typeof err.message === 'string' &&
          err.message.toLowerCase().includes('shipment does not exist')
        ) {
          this.logger.warn(
            `[Polling] Ignoring "shipment does not exist" for ${shipment.id} — check trackingId vs providerShipmentId and Topship env; local status unchanged.`,
          );
        }
      }
    }

    this.logger.log(`[Polling] Completed. Updated ${updated} shipment(s)`);
  }

  private async sendTrackingNotification(shipment: any, newStatus: string) {
    const order = shipment.order;
    const customer = order?.user;
    if (!customer) return;

    const isOutbound = shipment.type === 'OUTBOUND';
    const isResale = shipment.type === 'RESALE';

    if (newStatus === 'IN_TRANSIT') {
      const title = isResale
        ? 'Your purchase is in transit!'
        : isOutbound
          ? 'Your rental is in transit!'
          : 'Return pickup in progress';
      const message = isResale
        ? 'Your item has been picked up and is on its way to you.'
        : isOutbound
          ? 'Your item has been picked up and is on its way to you.'
          : 'The rider has picked up your item for return.';

      await this.notification.createNotification({
        userId: customer.id,
        title,
        message,
        type: isResale
          ? 'SHIPMENT_IN_TRANSIT'
          : isOutbound
            ? 'SHIPMENT_IN_TRANSIT'
            : 'RETURN_IN_TRANSIT',
        metadata: {
          shipmentId: shipment.id,
          orderId: order.orderId,
        },
        sendEmail: true,
        emailData: {
          email: customer.email,
          userName: customer.name,
          orderId: order.orderId,
          status: isResale
            ? 'In Transit'
            : isOutbound
              ? 'In Transit'
              : 'Return Pickup In Progress',
          trackingNumber: shipment.trackingId ?? undefined,
          estimatedDelivery: undefined,
        },
      });
    }

    if (newStatus === 'COMPLETED') {
      const title = isResale
        ? 'Your purchase has been delivered!'
        : isOutbound
          ? 'Your rental has been delivered!'
          : 'Return confirmed';
      const message = isResale
        ? 'Your item has been delivered. Enjoy your purchase!'
        : isOutbound
          ? 'Your item has been delivered. Enjoy your rental!'
          : 'Your return has been confirmed. Your rental period has ended.';

      await this.notification.createNotification({
        userId: customer.id,
        title,
        message,
        type: isResale
          ? 'SHIPMENT_DELIVERED'
          : isOutbound
            ? 'SHIPMENT_DELIVERED'
            : 'RETURN_CONFIRMED',
        metadata: {
          shipmentId: shipment.id,
          orderId: order.orderId,
        },
        sendEmail: true,
        emailData: {
          email: customer.email,
          userName: customer.name,
          orderId: order.orderId,
          status: isResale
            ? 'Delivered'
            : isOutbound
              ? 'Delivered'
              : 'Return Confirmed',
          trackingNumber: shipment.trackingId ?? undefined,
          estimatedDelivery: undefined,
        },
      });
    }
  }

  private async notifyAdminOfProviderCancellation(
    shipment: any,
    tracking: TrackingStatus,
  ) {
    const adminUrl = process.env.ADMIN_URL ?? '';
    const providerStatus = tracking.status || 'Cancelled';
    const order = shipment.order;

    const admins = await fetchAdminAlertRecipients(this.prisma);
    if (admins.length === 0) {
      this.logger.warn(
        `[Polling] No admin users found for shipment cancellation alert (shipment ${shipment.id}).`,
      );
      return;
    }

    const adminShipmentUrl = adminUrl
      ? `${adminUrl}/shipments/${shipment.id}`
      : undefined;

    for (const admin of admins) {
      await this.notification.createNotification({
        userId: admin.id,
        title: '🚨 Shipment cancelled by Topship',
        message: `Shipment ${shipment.id} (${shipment.type}) was cancelled by Topship (status: ${providerStatus}).`,
        type: 'SHIPMENT_PROVIDER_CANCELLED',
        metadata: {
          shipmentId: shipment.id,
          orderId: order?.orderId ?? shipment.orderId,
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
          orderId: order?.orderId ?? shipment.orderId,
          shipmentType: shipment.type,
          providerStatus,
          providerMessage: tracking.message,
          trackingUrl: shipment.providerTrackingUrl ?? undefined,
          adminShipmentUrl,
        });
      } catch (err: any) {
        this.logger.error(
          `[Polling] Failed to send admin cancellation email to ${admin.email} for shipment ${shipment.id}: ${err.message}`,
        );
      }
    }
  }
}
