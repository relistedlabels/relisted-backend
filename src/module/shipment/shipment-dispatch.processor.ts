import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { DeliveryProviderService } from 'src/services/delivery/delivery-provider.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { syncOrderStatusFromShipments } from 'src/module/order/order-shipment-status.sync';
import { fetchAdminAlertRecipients } from 'src/module/shipment/shipment-admin-alert-recipients';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [
  0, // attempt 1 — immediate (enqueued by cron)
  5 * 60_000, // attempt 2 — 5 minutes after 1st failure
  15 * 60_000, // attempt 3 — 15 minutes after 2nd failure
];

function formatDispatchWindowLagos(start: Date, end: Date): string {
  const tz = 'Africa/Lagos';
  const dateOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return `${start.toLocaleDateString('en-NG', dateOpts)}, ${start.toLocaleTimeString('en-NG', timeOpts)} – ${end.toLocaleTimeString('en-NG', timeOpts)}`;
}

@Processor('shipment-dispatch')
export class ShipmentDispatchProcessor {
  private readonly logger = new Logger(ShipmentDispatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryProviderService,
    private readonly notification: NotificationService,
    private readonly mail: MailService,
    @InjectQueue('shipment-dispatch') private readonly queue: Queue,
  ) {}

  @Process('dispatch')
  async handleDispatch(job: Job<{ shipmentId: string }>) {
    const { shipmentId } = job.data;
    this.logger.log(`[Worker] Processing dispatch for shipment ${shipmentId}`);

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            orderItems: {
              include: {
                product: { select: { name: true, originalValue: true } },
              },
            },
          },
        },
      },
    });

    if (!shipment) {
      this.logger.warn(`[Worker] Shipment ${shipmentId} not found — skipping`);
      return;
    }

    // Skip cancelled shipments that may have been cancelled between cron lock and worker pickup
    if (shipment.status === 'CANCELLED') {
      this.logger.warn(
        `[Worker] Shipment ${shipmentId} is CANCELLED — skipping`,
      );
      return;
    }

    const attemptNumber = shipment.dispatchAttempts + 1;
    const start = Date.now();

    try {
      const provider = this.delivery.forShipment(shipment);
      this.logger.log(
        `[Worker] Calling Topship to book shipment ${shipmentId} (${shipment.type})...`,
      );
      const result = await provider.dispatch(
        shipment as any,
        shipment.order as any,
      );

      const durationMs = Date.now() - start;

      this.logger.log(
        `[Worker] ✅ Topship booking SUCCESS for shipment ${shipmentId}: providerShipmentId=${result.providerShipmentId}, trackingId=${result.trackingId}, trackingUrl=${result.providerTrackingUrl}`,
      );

      await this.prisma.$transaction([
        this.prisma.shipment.update({
          where: { id: shipmentId },
          data: {
            status: 'DISPATCHED',
            dispatchedAt: new Date(),
            providerShipmentId: result.providerShipmentId,
            providerTrackingUrl: result.providerTrackingUrl ?? null,
            trackingId: result.trackingId ?? null,
            dispatchAttempts: attemptNumber,
          },
        }),
        this.prisma.dispatchAttemptLog.create({
          data: {
            shipmentId,
            attemptNumber,
            success: true,
            durationMs,
          },
        }),
      ]);

      this.logger.log(
        `[Worker] Shipment ${shipmentId} dispatched successfully (attempt ${attemptNumber}, ${durationMs}ms)`,
      );

      await this.sendDispatchNotification(shipment as any, result);

      try {
        await syncOrderStatusFromShipments(this.prisma, shipment.orderId);
      } catch (syncErr: any) {
        this.logger.warn(
          `[Worker] Order status sync after dispatch failed for order ${shipment.orderId}: ${syncErr?.message ?? syncErr}`,
        );
      }
    } catch (err: any) {
      const durationMs = Date.now() - start;
      this.logger.error(
        `[Worker] Dispatch attempt ${attemptNumber} failed for shipment ${shipmentId}: ${err.message}`,
      );

      // Log the failed attempt
      await this.prisma.$transaction([
        this.prisma.shipment.update({
          where: { id: shipmentId },
          data: { dispatchAttempts: attemptNumber },
        }),
        this.prisma.dispatchAttemptLog.create({
          data: {
            shipmentId,
            attemptNumber,
            success: false,
            errorCode: String(err.status ?? err.code ?? 'ERR'),
            errorMessage: err.message?.substring(0, 2000) ?? 'Unknown error',
            durationMs,
          },
        }),
      ]);

      if (attemptNumber >= MAX_ATTEMPTS) {
        // All retries exhausted — mark as failed and alert admin
        await this.prisma.shipment.update({
          where: { id: shipmentId },
          data: { status: 'DISPATCH_FAILED' },
        });
        this.logger.error(
          `[Worker] Shipment ${shipmentId} DISPATCH_FAILED — notifying admin`,
        );
        await this.notifyAdminOfFailure(shipment as any, err.message);
        return; // Do NOT re-throw — stop Bull from auto-retrying beyond our logic
      }

      // Re-queue with backoff delay; reset status to PENDING so lock can be re-acquired
      const delayMs = RETRY_DELAYS_MS[attemptNumber] ?? 15 * 60_000;
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: { status: 'PENDING' },
      });

      // Small grace period before re-lock so the DB write settles
      await this.queue.add(
        'dispatch',
        { shipmentId },
        { delay: delayMs, attempts: 1 },
      );

      // Re-lock for next attempt immediately after queuing
      await this.prisma.shipment.updateMany({
        where: { id: shipmentId, status: 'PENDING' },
        data: { status: 'DISPATCHING' },
      });

      this.logger.log(
        `[Worker] Shipment ${shipmentId} re-queued (attempt ${attemptNumber + 1} in ${delayMs / 60_000}m)`,
      );
    }
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  private async sendDispatchNotification(shipment: any, result: any) {
    const order = shipment.order;
    const customer = order?.user;
    if (!customer) return;

    const isOutbound = shipment.type === 'OUTBOUND';
    const isResale = shipment.type === 'RESALE';
    const isReturn = shipment.type === 'RETURN';

    let title: string;
    let message: string;
    let notificationType: string;
    let status: string;

    if (isResale) {
      title = '🚚 Your purchase is on its way!';
      message = `Your item is being dispatched. Track here: ${result.providerTrackingUrl ?? 'Tracking link coming soon'}`;
      notificationType = 'SHIPMENT_DISPATCHED';
      status = 'Dispatched';
    } else if (isOutbound) {
      title = '🚚 Your rental is on its way!';
      message = `Your item is being dispatched. Track here: ${result.providerTrackingUrl ?? 'Tracking link coming soon'}`;
      notificationType = 'SHIPMENT_DISPATCHED';
      status = 'Dispatched';
    } else if (isReturn) {
      const wStart = shipment.scheduledWindowStart
        ? new Date(shipment.scheduledWindowStart)
        : null;
      const wEnd = shipment.scheduledWindowEnd
        ? new Date(shipment.scheduledWindowEnd)
        : null;
      const windowLine =
        wStart && wEnd
          ? ` Pickup window: ${formatDispatchWindowLagos(wStart, wEnd)}.`
          : '';
      title = '📦 Return scheduled for dispatch';
      message = `Your return is scheduled for carrier pickup (booked with Topship).${windowLine} Have the item ready during your window — you will get another update when the package is on the way.`;
      notificationType = 'RETURN_DISPATCHED';
      status = 'Scheduled for dispatch (pickup not started yet)';
    } else {
      return; // Unknown shipment type
    }

    await this.notification.createNotification({
      userId: customer.id,
      title,
      message,
      type: notificationType,
      metadata: {
        shipmentId: shipment.id,
        orderId: order.orderId,
        trackingUrl: result.providerTrackingUrl,
      },
      sendEmail: true,
      emailData: {
        email: customer.email,
        userName: customer.name,
        orderId: order.orderId,
        status,
        trackingNumber: result.trackingId ?? undefined,
        estimatedDelivery: undefined,
        ...(isReturn &&
        shipment.scheduledWindowStart &&
        shipment.scheduledWindowEnd
          ? {
              emailSubject: 'Return pickup scheduled',
              emailHeading: 'Return pickup scheduled',
              pickupWindowSummary: formatDispatchWindowLagos(
                new Date(shipment.scheduledWindowStart),
                new Date(shipment.scheduledWindowEnd),
              ),
              extraNote:
                '"Scheduled for dispatch" means the carrier has been booked for your pickup window. It does not mean the rider has already collected the package — watch for an in-transit update next.',
            }
          : isReturn
            ? {
                emailSubject: 'Return pickup scheduled',
                emailHeading: 'Return pickup scheduled',
                extraNote:
                  'The carrier has been booked for your return. You will get another update when pickup starts.',
              }
            : {}),
      },
    });
  }

  private async notifyAdminOfFailure(shipment: any, errorMessage: string) {
    const adminUrl = process.env.ADMIN_URL ?? '';
    const redispatchUrl = adminUrl
      ? `${adminUrl}/shipments/${shipment.id}`
      : '';

    const admins = await fetchAdminAlertRecipients(this.prisma);
    if (admins.length === 0) {
      this.logger.warn(
        `[Worker] No admin users found for dispatch failure alert (shipment ${shipment.id}).`,
      );
      return;
    }

    for (const admin of admins) {
      await this.notification.createNotification({
        userId: admin.id,
        title: '⚠️ Shipment Dispatch Failed',
        message: `Shipment ${shipment.id} (${shipment.type}) failed all ${MAX_ATTEMPTS} retries. Manual action required.`,
        type: 'DISPATCH_FAILED',
        metadata: {
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          shipmentType: shipment.type,
          error: errorMessage,
          redispatchUrl,
        },
      });
    }

    for (const admin of admins) {
      if (!admin.email?.trim()) continue;
      try {
        await this.mail.sendAdminDispatchFailureAlert?.({
          to: admin.email.trim(),
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          shipmentType: shipment.type,
          scheduledDate: shipment.scheduledDate,
          errorMessage,
          redispatchUrl,
        });
      } catch (mailErr: any) {
        this.logger.error(
          `[Worker] Failed to send admin failure email to ${admin.email}: ${mailErr.message}`,
        );
      }
    }
  }
}
