import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ListingType, ShipmentType } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { DeliveryProviderService } from 'src/services/delivery/delivery-provider.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { ShipmentTrackingSyncService } from './shipment-tracking-sync.service';
import {
  addHours,
  addMinutes,
  startOfDay,
  subHours,
  subMinutes,
} from 'date-fns';
import { fetchAdminAlertRecipients } from 'src/module/shipment/shipment-admin-alert-recipients';
import { buildAdminShipmentsPageUrl } from 'src/module/shipment/build-admin-shipments-page-url';
import { OrderService } from 'src/module/order/order.service';

const DISPATCH_CRON_LOOKAHEAD_MINUTES = Number(
  process.env.DISPATCH_CRON_LOOKAHEAD_MINUTES ?? 59,
);

/** Hours after `pickupWindowEnd` before we email listers (carrier tracking often lags). */
const LISTER_RETURN_WINDOW_PASSED_GRACE_HOURS = Number(
  process.env.LISTER_RETURN_WINDOW_PASSED_GRACE_HOURS ?? 6,
);
const RETURN_DUE_REMINDER_MORNING_HOUR = Number(
  process.env.RETURN_DUE_REMINDER_MORNING_HOUR ?? 8,
);
const RETURN_DUE_REMINDER_MORNING_CATCHUP_HOURS = Number(
  process.env.RETURN_DUE_REMINDER_MORNING_CATCHUP_HOURS ?? 0,
);

const DISPATCH_CRON_SCHEDULE =
  process.env.DISPATCH_CRON?.trim() || '0 * * * *';
const POLLING_CRON_SCHEDULE =
  process.env.POLLING_CRON?.trim() || '*/10 * * * *';
const LISTER_RETURN_WINDOW_CRON_SCHEDULE =
  process.env.LISTER_RETURN_WINDOW_CRON?.trim() || '45 * * * *';
const RETURN_DUE_REMINDER_CRON_SCHEDULE =
  process.env.RETURN_DUE_REMINDER_CRON?.trim() || '*/15 * * * *';
/** Admin nudges for pending manual Relisted dispatch legs (defaults to same cadence as renter return reminders). */
const MANUAL_FULFILLMENT_DUE_REMINDER_CRON_SCHEDULE =
  process.env.MANUAL_FULFILLMENT_DUE_REMINDER_CRON?.trim() ||
  RETURN_DUE_REMINDER_CRON_SCHEDULE;
const RESALE_INSPECTION_RELEASE_CRON_SCHEDULE =
  process.env.RESALE_INSPECTION_RELEASE_CRON?.trim() || '0 * * * *';

@Injectable()
export class ShipmentDispatchScheduler {
  private readonly logger = new Logger(ShipmentDispatchScheduler.name);
  private readonly lagosDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  private readonly lagosHourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    hour12: false,
  });

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shipment-dispatch') private readonly queue: Queue,
    private readonly delivery: DeliveryProviderService,
    private readonly notification: NotificationService,
    private readonly mail: MailService,
    private readonly trackingSync: ShipmentTrackingSyncService,
    private readonly orderService: OrderService,
  ) {}

  /**
   * Runs on the configured cadence (defaults to hourly) in Africa/Lagos time.
   * Scans for pending shipments whose dispatch window starts within the lookahead
   * horizon (defaults to 0 minutes, meaning at/after start) and locks + enqueues
   * each one exactly once.
   * `scheduledWindowStart` / `scheduledWindowEnd` are Relisted-only; the worker maps
   * them to Topship’s single `pickupDate` when booking, not as partner-facing windows.
   */
  @Cron(DISPATCH_CRON_SCHEDULE, { timeZone: 'Africa/Lagos' })
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
        manualFulfillment: false,
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
   * Polls carriers for tracking status (backup to webhooks).
   * Shipbubble also pushes updates to POST /webhook/shipbubble; both paths use
   * ShipmentTrackingSyncService with forward-only rules so they do not fight.
   * Only checks shipments that are DISPATCHED or IN_TRANSIT.
   */
  @Cron(POLLING_CRON_SCHEDULE, { timeZone: 'Africa/Lagos' })
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

    this.logger.log(`[Polling] Found ${shipments.length} shipment(s) to poll`);

    let updated = 0;
    for (const shipment of shipments) {
      try {
        this.logger.debug(
          `[Polling] Checking shipment ${shipment.id} (providerShipmentId=${shipment.providerShipmentId}, trackingId=${shipment.trackingId ?? 'none'}, currentStatus=${shipment.status})`,
        );
        const provider = this.delivery.forShipment(shipment as any);
        const tracking = await provider.getTrackingStatus({
          providerShipmentId: shipment.providerShipmentId!,
          trackingId: shipment.trackingId,
        });

        const providerStatus = (tracking.status || 'UNKNOWN').trim();
        this.logger.debug(
          `[Polling] Provider status for shipment ${shipment.id}: ${providerStatus}, message=${tracking.message ?? 'n/a'}`,
        );

        const result = await this.trackingSync.applyProviderTrackingUpdate({
          shipment: shipment as any,
          providerStatus,
          source: 'poll',
          tracking,
        });
        if (result.updated) {
          updated++;
        }
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
  @Cron(LISTER_RETURN_WINDOW_CRON_SCHEDULE, {
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
          select: { id: true, shipmentId: true },
        },
        shipments: {
          where: { type: 'RETURN' },
          orderBy: [{ scheduledWindowStart: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, status: true },
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

      const rrShipId = rr.shipmentId;
      const returnLeg = rrShipId
        ? ord.shipments.find((s) => s.id === rrShipId)
        : ord.shipments[0];
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

  /**
   * Renter return due reminders:
   * - 24-hour reminder (day before pickup window)
   * - morning-of reminder (default 8 AM Africa/Lagos)
   *
   * These reminders are based on return request pickup windows and do not
   * depend on whether the return shipment has already been booked/dispatched.
   */
  @Cron(RETURN_DUE_REMINDER_CRON_SCHEDULE, {
    timeZone: 'Africa/Lagos',
  })
  async sendRenterReturnDueReminders() {
    const now = new Date();
    const lookahead = addHours(now, 30);
    const lookbehind = subHours(now, 12);
    const rentalish = [ListingType.RENTAL, ListingType.RENT_OR_RESALE];

    const orders = await this.prisma.order.findMany({
      where: {
        listingType: { in: rentalish },
        // Do not gate reminders on RETURN_DUE only, so renters in ACTIVE/other
        // non-final states still get nudged before pickup is due.
        status: { notIn: ['RETURNED', 'COMPLETED', 'CANCELLED', 'REJECTED'] },
        shipments: {
          some: {
            type: 'RETURN',
            scheduledWindowStart: {
              gte: lookbehind,
              lte: lookahead,
            },
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
        },
      },
      select: {
        id: true,
        orderId: true,
        userId: true,
        returnRequestReminderSentAt: true,
        returnReminderMorningSentAt: true,
        user: { select: { email: true, name: true } },
        orderItems: {
          take: 1,
          select: { product: { select: { name: true } } },
        },
        shipments: {
          where: {
            type: 'RETURN',
            scheduledWindowStart: {
              gte: lookbehind,
              lte: lookahead,
            },
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
          orderBy: [{ scheduledWindowStart: 'asc' }, { createdAt: 'asc' }],
          take: 1,
          select: {
            id: true,
            scheduledWindowStart: true,
            scheduledWindowEnd: true,
          },
        },
      },
    });

    if (orders.length === 0) return;

    const nowLagosDate = this.toLagosDateKey(now);
    const nowLagosHour = this.toLagosHour(now);
    const clientUrl = process.env.CLIENT_URL || 'https://relisted.com';

    for (const order of orders) {
      if (!order.user?.email?.trim()) continue;
      const returnShipment = order.shipments[0];

      const pickupStart = returnShipment?.scheduledWindowStart
        ? new Date(returnShipment.scheduledWindowStart)
        : null;
      const pickupEnd = returnShipment?.scheduledWindowEnd
        ? new Date(returnShipment.scheduledWindowEnd)
        : null;
      if (!pickupStart) continue;

      const pickupLagosDate = this.toLagosDateKey(pickupStart);
      const msUntilPickup = pickupStart.getTime() - now.getTime();
      const msSincePickup = now.getTime() - pickupStart.getTime();
      const isPickupTodayInLagos = pickupLagosDate === nowLagosDate;
      const shouldSend24h =
        !order.returnRequestReminderSentAt &&
        msUntilPickup > 0 &&
        msUntilPickup <= 24 * 60 * 60 * 1000 &&
        !isPickupTodayInLagos;
      const isWithinMorningCatchup =
        RETURN_DUE_REMINDER_MORNING_CATCHUP_HOURS > 0 &&
        msSincePickup >= 0 &&
        msSincePickup <=
          RETURN_DUE_REMINDER_MORNING_CATCHUP_HOURS * 60 * 60 * 1000;
      const shouldSendMorningOf =
        !order.returnReminderMorningSentAt &&
        ((isPickupTodayInLagos &&
          nowLagosHour >= RETURN_DUE_REMINDER_MORNING_HOUR) ||
          isWithinMorningCatchup);

      if (!shouldSend24h && !shouldSendMorningOf) continue;

      const orderLink = `${clientUrl}/renters/orders/${order.orderId}`;
      const productName = order.orderItems[0]?.product?.name ?? 'your rental item';
      const pickupWindowLabel = this.formatLagosPickupWindow(
        pickupStart,
        pickupEnd,
      );

      if (shouldSend24h) {
        await this.notification.createNotification({
          userId: order.userId,
          title: 'Return pickup due in 24 hours',
          message: `Your return pickup for order ${order.orderId} is within the next 24 hours. Please have your item ready.`,
          type: 'RETURN_DUE_REMINDER',
          metadata: {
            orderId: order.id,
            orderNumber: order.orderId,
            shipmentId: returnShipment?.id ?? null,
            reminderType: '24_hours',
          },
          sendEmail: true,
          emailData: {
            email: order.user.email.trim(),
            userName: order.user.name || 'there',
            orderId: order.orderId,
            orderLink,
            dueDate: pickupWindowLabel,
            productName,
            reminderType: '24_hours',
          },
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: { returnRequestReminderSentAt: now },
        });
      }

      if (shouldSendMorningOf) {
        await this.notification.createNotification({
          userId: order.userId,
          title: 'Return pickup is today',
          message: `Your return pickup for order ${order.orderId} is scheduled for today. Please keep your item ready for collection.`,
          type: 'RETURN_DUE_REMINDER',
          metadata: {
            orderId: order.id,
            orderNumber: order.orderId,
            shipmentId: returnShipment?.id ?? null,
            reminderType: 'morning_of',
          },
          sendEmail: true,
          emailData: {
            email: order.user.email.trim(),
            userName: order.user.name || 'there',
            orderId: order.orderId,
            orderLink,
            dueDate: pickupWindowLabel,
            productName,
            reminderType: 'morning_of',
          },
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: { returnReminderMorningSentAt: now },
        });
      }
    }
  }

  /**
   * Admin reminders for pending manual Relisted dispatch legs (mirrors renter return timing):
   * - “within 24 hours” when the due start is in the next 24h but not the same Lagos calendar day
   * - “due today” at {@link RETURN_DUE_REMINDER_MORNING_HOUR} Lagos (same env as renter return reminders)
   */
  @Cron(MANUAL_FULFILLMENT_DUE_REMINDER_CRON_SCHEDULE, {
    timeZone: 'Africa/Lagos',
  })
  async sendAdminManualFulfillmentDueReminders() {
    const now = new Date();
    const admins = await fetchAdminAlertRecipients(this.prisma);
    if (admins.length === 0) {
      this.logger.warn(
        '[ManualDueReminder] No admin recipients configured; skipping.',
      );
      return;
    }

    const shipments = await this.prisma.shipment.findMany({
      where: {
        manualFulfillment: true,
        status: 'PENDING',
        order: {
          status: {
            notIn: ['RETURNED', 'COMPLETED', 'CANCELLED', 'REJECTED'],
          },
        },
      },
      select: {
        id: true,
        type: true,
        scheduledWindowStart: true,
        scheduledWindowEnd: true,
        scheduledDate: true,
        manualDueReminder24hSentAt: true,
        manualDueReminderMorningSentAt: true,
        order: { select: { orderId: true } },
      },
    });

    if (shipments.length === 0) return;

    const nowLagosDate = this.toLagosDateKey(now);
    const nowLagosHour = this.toLagosHour(now);
    const maxAheadMs = 49 * 60 * 60 * 1000;

    let sent24 = 0;
    let sentMorning = 0;

    for (const s of shipments) {
      const dueStart = s.scheduledWindowStart
        ? new Date(s.scheduledWindowStart)
        : new Date(s.scheduledDate);
      const pickupEnd = s.scheduledWindowEnd
        ? new Date(s.scheduledWindowEnd)
        : null;

      const msUntilDue = dueStart.getTime() - now.getTime();
      if (msUntilDue > maxAheadMs) continue;

      const dueLagosDate = this.toLagosDateKey(dueStart);
      const isDueTodayInLagos = dueLagosDate === nowLagosDate;

      const shouldSend24h =
        !s.manualDueReminder24hSentAt &&
        msUntilDue > 0 &&
        msUntilDue <= 24 * 60 * 60 * 1000 &&
        !isDueTodayInLagos;

      const msSinceDueStart = now.getTime() - dueStart.getTime();
      const isWithinMorningCatchup =
        RETURN_DUE_REMINDER_MORNING_CATCHUP_HOURS > 0 &&
        msSinceDueStart >= 0 &&
        msSinceDueStart <=
          RETURN_DUE_REMINDER_MORNING_CATCHUP_HOURS * 60 * 60 * 1000;

      const shouldSendMorningOf =
        !s.manualDueReminderMorningSentAt &&
        ((isDueTodayInLagos &&
          nowLagosHour >= RETURN_DUE_REMINDER_MORNING_HOUR) ||
          isWithinMorningCatchup);

      if (!shouldSend24h && !shouldSendMorningOf) continue;

      const humanOrderId = s.order.orderId;
      const dueSummary = this.formatLagosPickupWindow(dueStart, pickupEnd);
      const legLabel = this.manualLegLabel(s.type);

      const pingAdmins = async (
        reminderKind: '24_hours' | 'morning_of',
        title: string,
        message: string,
      ) => {
        for (const admin of admins) {
          await this.notification.createNotification({
            userId: admin.id,
            title,
            message,
            type: 'MANUAL_FULFILLMENT_DUE_REMINDER',
            metadata: {
              orderId: humanOrderId,
              shipmentId: s.id,
              reminderKind,
            },
          });
        }
        for (const admin of admins) {
          if (!admin.email?.trim()) continue;
          try {
            await this.mail.sendAdminManualFulfillmentDueReminder({
              to: admin.email.trim(),
              humanOrderId,
              shipmentId: s.id,
              legLabel,
              adminShipmentUrl:
                buildAdminShipmentsPageUrl({ shipmentId: s.id }) || '',
              reminderKind,
              dueSummary,
            });
          } catch (mailErr: any) {
            this.logger.warn(
              `[ManualDueReminder] Email to ${admin.email} failed: ${mailErr?.message ?? mailErr}`,
            );
          }
        }
      };

      if (shouldSend24h) {
        await pingAdmins(
          '24_hours',
          'Manual dispatch due within 24 hours',
          `Order ${humanOrderId}: ${legLabel}. Scheduled: ${dueSummary}. Mark dispatched in admin when booking is done.`,
        );
        await this.prisma.shipment.update({
          where: { id: s.id },
          data: { manualDueReminder24hSentAt: now },
        });
        sent24 += 1;
      }

      if (shouldSendMorningOf) {
        await pingAdmins(
          'morning_of',
          'Manual dispatch due today',
          `Order ${humanOrderId}: ${legLabel}. Scheduled: ${dueSummary}. Mark dispatched in admin when booking is done.`,
        );
        await this.prisma.shipment.update({
          where: { id: s.id },
          data: { manualDueReminderMorningSentAt: now },
        });
        sentMorning += 1;
      }
    }

    if (sent24 > 0 || sentMorning > 0) {
      this.logger.log(
        `[ManualDueReminder] Sent ${sent24} x 24h + ${sentMorning} morning admin reminder(s).`,
      );
    }
  }

  private toLagosDateKey(date: Date): string {
    return this.lagosDateFormatter.format(date);
  }

  private toLagosHour(date: Date): number {
    return Number(this.lagosHourFormatter.format(date));
  }

  private formatLagosPickupWindow(start: Date, end: Date | null): string {
    const tz = 'Africa/Lagos';
    const startLabel = start.toLocaleString('en-NG', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    if (!end) return `${startLabel} (WAT)`;
    const endLabel = end.toLocaleString('en-NG', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${startLabel} to ${endLabel} (WAT)`;
  }

  private manualLegLabel(type: ShipmentType): string {
    switch (type) {
      case 'OUTBOUND':
        return 'Rental delivery (to renter)';
      case 'RETURN':
        return 'Return (to lister)';
      case 'RESALE':
        return 'Purchase delivery';
      default:
        return 'Shipment';
    }
  }

  /**
   * Auto-complete resale orders after the inspection window (buyer did not confirm or dispute).
   */
  @Cron(RESALE_INSPECTION_RELEASE_CRON_SCHEDULE, { timeZone: 'Africa/Lagos' })
  async autoReleaseResaleAfterInspectionPeriod() {
    try {
      const result =
        await this.orderService.autoCompleteDeliveredResaleOrders();
      if (result.processed > 0) {
        this.logger.log(
          `[ResaleInspection] Auto-completed ${result.processed} resale order(s)`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[ResaleInspection] Auto-complete failed: ${err?.message ?? err}`,
      );
    }
  }
}
