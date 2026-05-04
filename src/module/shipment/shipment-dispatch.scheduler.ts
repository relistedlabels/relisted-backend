import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ListingType } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { DeliveryProviderService } from 'src/services/delivery/delivery-provider.service';
import { TrackingStatus } from 'src/services/delivery/delivery-provider.interface';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { syncOrderStatusFromShipments } from 'src/module/order/order-shipment-status.sync';
import { addMinutes, startOfDay, subHours, subMinutes } from 'date-fns';
import { fetchAdminAlertRecipients } from 'src/module/shipment/shipment-admin-alert-recipients';

const normalizeProviderStatus = (status: string) =>
  status.toLowerCase().replace(/[^a-z]/g, '');

const DISPATCH_CRON_LOOKAHEAD_MINUTES = Number(
  process.env.DISPATCH_CRON_LOOKAHEAD_MINUTES ?? 60,
);

/** Hours after `pickupWindowEnd` before we email listers (carrier tracking often lags). */
const LISTER_RETURN_WINDOW_PASSED_GRACE_HOURS = Number(
  process.env.LISTER_RETURN_WINDOW_PASSED_GRACE_HOURS ?? 6,
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

        // Send notification (renter + lister for return legs)
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

  /**
   * When the return pickup window ended some time ago (grace period — default 6h)
   * but the RETURN leg is still not COMPLETED in our DB, remind listers once.
   * Gives carrier polling time to catch up before we nudge.
   */
  @Cron(process.env.LISTER_RETURN_WINDOW_CRON || '45 * * * *', {
    timeZone: 'Africa/Lagos',
  })
  async notifyListerReturnWindowPassedWithoutDelivery() {
    const now = new Date();
    const rentalish = [ListingType.RENTAL, ListingType.RENT_OR_RESALE];
    const cutoff = subHours(now, LISTER_RETURN_WINDOW_PASSED_GRACE_HOURS);

    const staleReturnRequestWhere = {
      listerReturnWindowPassedNotifiedAt: null,
      pickupWindowEnd: { lte: cutoff },
      status: { notIn: ['COMPLETED', 'REJECTED'] },
    };

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['RETURN_DUE', 'RETURNED'] },
        listingType: { in: rentalish },
        returnRequests: {
          some: staleReturnRequestWhere,
        },
      },
      select: {
        id: true,
        orderId: true,
        returnRequests: {
          where: staleReturnRequestWhere,
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        },
        shipments: {
          where: { type: 'RETURN' },
          select: { status: true },
        },
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

    if (orders.length > 0) {
      this.logger.log(
        `[ReturnWindowPassed] ${orders.length} order(s) eligible (pickup ended ≥${LISTER_RETURN_WINDOW_PASSED_GRACE_HOURS}h ago, return not delivered in tracking)`,
      );
    }

    const clientUrl = process.env.CLIENT_URL || 'https://relisted.com';

    for (const ord of orders) {
      const rr = ord.returnRequests[0];
      if (!rr) continue;

      const returnLeg = ord.shipments[0];
      if (returnLeg?.status === 'COMPLETED') continue;

      const listers = new Map<
        string,
        {
          id: string;
          email: string | null;
          name: string | null;
          profile: {
            businessInfo: { businessName: string | null } | null;
          } | null;
        }
      >();
      for (const oi of ord.orderItems) {
        const c = oi.product?.curator;
        if (c?.id) listers.set(c.id, c as any);
      }

      const orderPageUrl = `${clientUrl}/listers/orders/${ord.id}`;

      for (const lister of listers.values()) {
        if (!lister.email?.trim()) continue;
        const curatorName =
          lister.profile?.businessInfo?.businessName || lister.name || 'there';
        await this.notification.createNotification({
          userId: lister.id,
          title: 'Return pickup window has ended',
          message: `The scheduled return window for order ${ord.orderId} has passed and we have not marked the return as delivered yet. If you have not received the item, coordinate with the renter; otherwise confirm receipt on your order page when it arrives.`,
          type: 'LISTER_RETURN_WINDOW_PASSED',
          metadata: {
            orderId: ord.id,
            orderNumber: ord.orderId,
            returnRequestId: rr.id,
          },
          sendEmail: true,
          emailData: {
            email: lister.email.trim(),
            curatorName,
            orderNumber: ord.orderId,
            orderPageUrl,
            platformName: 'Relisted',
          },
        });
      }

      await this.prisma.returnRequest.update({
        where: { id: rr.id },
        data: { listerReturnWindowPassedNotifiedAt: now },
      });
    }
  }

  private async sendTrackingNotification(shipment: any, newStatus: string) {
    const order = shipment.order;
    const customer = order?.user;
    if (!customer) return;

    const isOutbound = shipment.type === 'OUTBOUND';
    const isResale = shipment.type === 'RESALE';
    const isReturn = shipment.type === 'RETURN';

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
          : 'The rider has picked up your item for return. It is on its way back to the lister.';

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

      if (isReturn) {
        await this.notifyListersForReturnLeg(shipment, 'IN_TRANSIT');
      }
    }

    if (newStatus === 'COMPLETED') {
      if (isReturn) {
        await this.notification.createNotification({
          userId: customer.id,
          title: 'Return delivered to the lister',
          message:
            'Carrier tracking shows your return was delivered. The lister will inspect the item and confirm receipt in the app. You will be notified when your collateral is released after they complete confirmation.',
          type: 'RETURN_DELIVERED_TO_LISTER',
          metadata: {
            shipmentId: shipment.id,
            orderId: order.orderId,
          },
          sendEmail: true,
          emailData: {
            email: customer.email,
            userName: customer.name,
            orderId: order.orderId,
            status: 'Delivered to lister (pending lister confirmation)',
            emailSubject: 'Your return was delivered',
            emailHeading: 'Return delivered',
            trackingNumber: shipment.trackingId ?? undefined,
            extraNote:
              'Your rental is not fully closed until the lister confirms they received the item in the expected condition.',
          },
        });
        await this.notifyListersForReturnLeg(shipment, 'COMPLETED');
        return;
      }

      const title = isResale
        ? 'Your purchase has been delivered!'
        : 'Your rental has been delivered!';
      const message = isResale
        ? 'Your item has been delivered. Enjoy your purchase!'
        : 'Your item has been delivered. Enjoy your rental!';

      await this.notification.createNotification({
        userId: customer.id,
        title,
        message,
        type: isResale ? 'SHIPMENT_DELIVERED' : 'SHIPMENT_DELIVERED',
        metadata: {
          shipmentId: shipment.id,
          orderId: order.orderId,
        },
        sendEmail: true,
        emailData: {
          email: customer.email,
          userName: customer.name,
          orderId: order.orderId,
          status: 'Delivered',
          trackingNumber: shipment.trackingId ?? undefined,
          estimatedDelivery: undefined,
        },
      });
    }
  }

  private async notifyListersForReturnLeg(
    shipment: any,
    phase: 'IN_TRANSIT' | 'COMPLETED',
  ) {
    const orderInternalId = shipment.order?.id as string | undefined;
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
    const trackingNumber = shipment.trackingId ?? undefined;

    const listers = new Map<
      string,
      {
        id: string;
        email: string | null;
        name: string | null;
        profile: {
          businessInfo: { businessName: string | null } | null;
        } | null;
      }
    >();

    for (const oi of full.orderItems) {
      const c = oi.product?.curator;
      if (c?.id) listers.set(c.id, c as any);
    }

    for (const lister of listers.values()) {
      if (!lister.email?.trim()) continue;
      const curatorName =
        lister.profile?.businessInfo?.businessName || lister.name || 'there';

      if (phase === 'IN_TRANSIT') {
        await this.notification.createNotification({
          userId: lister.id,
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
            trackingNumber,
            platformName: 'Relisted',
          },
        });
      } else {
        await this.notification.createNotification({
          userId: lister.id,
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
            trackingNumber,
            platformName: 'Relisted',
          },
        });
      }
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
