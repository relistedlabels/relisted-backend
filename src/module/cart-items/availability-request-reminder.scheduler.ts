import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AvailabilityStatus } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import {
  applyAvailabilityRequestReminderState,
  checkoutReminderCopy,
  computeCheckoutReminderActions,
  computeExpiredListerReminderActions,
  expiredListerReminderCopy,
  type AvailabilityReminderAction,
} from './availability-request-reminder.util';

const AVAILABILITY_REMINDER_CRON =
  process.env.AVAILABILITY_REQUEST_REMINDER_CRON?.trim() || '*/5 * * * *';

/** Only remind on requests in this recent window (ignore historical expired/approved rows). */
const REMINDER_LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.AVAILABILITY_REQUEST_REMINDER_LOOKBACK_DAYS ?? 3),
);

@Injectable()
export class AvailabilityRequestReminderScheduler {
  private readonly logger = new Logger(
    AvailabilityRequestReminderScheduler.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
  ) {}

  private clientBase(): string {
    return (
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  private lookbackCutoff(now: Date): Date {
    return new Date(
      now.getTime() - REMINDER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  private requestType(rentalDays: number | null | undefined): 'purchase' | 'rental' {
    return (rentalDays ?? 0) === 0 ? 'purchase' : 'rental';
  }

  /** PENDING past expiresAt → EXPIRED so reminder queries stay honest. */
  private async expireStalePending() {
    await this.prisma.availabilityRequest.updateMany({
      where: {
        status: AvailabilityStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: AvailabilityStatus.EXPIRED },
    });
  }

  @Cron(AVAILABILITY_REMINDER_CRON, { timeZone: 'Africa/Lagos' })
  async sendAvailabilityRequestReminders() {
    const now = new Date();
    const since = this.lookbackCutoff(now);
    await this.expireStalePending();

    let checkoutSent = 0;
    let expiredListerSent = 0;

    const accepted = await this.prisma.availabilityRequest.findMany({
      where: {
        status: AvailabilityStatus.ACCEPTED,
        approvedAt: { gte: since },
      },
      include: {
        product: { select: { name: true } },
        requester: { select: { id: true, name: true, email: true } },
        lister: { select: { name: true } },
      },
      take: 200,
      orderBy: { approvedAt: 'asc' },
    });

    for (const request of accepted) {
      const actions = computeCheckoutReminderActions(
        now,
        request.approvedAt,
        request.reminderState,
      );
      for (const action of actions) {
        const ok = await this.sendCheckoutReminder(request, action, now);
        if (ok) checkoutSent += 1;
      }
    }

    const expired = await this.prisma.availabilityRequest.findMany({
      where: {
        status: AvailabilityStatus.EXPIRED,
        expiresAt: { gte: since },
      },
      include: {
        product: { select: { name: true } },
        requester: { select: { name: true } },
        lister: { select: { id: true, name: true, email: true } },
      },
      take: 200,
      orderBy: { expiresAt: 'asc' },
    });

    for (const request of expired) {
      const actions = computeExpiredListerReminderActions(
        now,
        request.expiresAt,
        request.reminderState,
      );
      for (const action of actions) {
        const ok = await this.sendExpiredListerReminder(request, action, now);
        if (ok) expiredListerSent += 1;
      }
    }

    if (checkoutSent || expiredListerSent) {
      this.logger.log(
        `[AvailabilityReminders] checkout=${checkoutSent}, expiredLister=${expiredListerSent}`,
      );
    }
  }

  private async sendCheckoutReminder(
    request: {
      id: string;
      productId: string;
      rentalDays: number | null;
      reminderState: unknown;
      product: { name: string } | null;
      requester: { id: string; name: string | null; email: string | null } | null;
      lister: { name: string | null } | null;
    },
    action: AvailabilityReminderAction,
    now: Date,
  ): Promise<boolean> {
    if (action.track !== 'checkout') return false;

    const productName = request.product?.name ?? 'this item';
    const requestType = this.requestType(request.rentalDays);
    const { title, message } = checkoutReminderCopy({
      productName,
      requestType,
      stage: action.stage,
    });
    const email = request.requester?.email?.trim() || '';
    const cartLink = `${this.clientBase()}/shop/cart`;

    try {
      await this.notification.createNotification({
        userId: request.requester!.id,
        title,
        message,
        type: 'AVAILABILITY_CHECKOUT_REMINDER',
        metadata: {
          requestId: request.id,
          productId: request.productId,
          stage: action.stage,
        },
        sendEmail: Boolean(email),
        emailData: {
          email,
          userName: request.requester?.name || 'there',
          listerName: request.lister?.name || 'The curator',
          productName,
          requestType,
          cartLink,
          stage: action.stage,
        },
      });

      const nextState = applyAvailabilityRequestReminderState(
        request.reminderState,
        action,
        now,
      );
      await this.prisma.availabilityRequest.update({
        where: { id: request.id },
        data: { reminderState: nextState },
      });
      request.reminderState = nextState;
      return true;
    } catch (e) {
      this.logger.error(
        `[AvailabilityReminders] checkout failed for ${request.id}: ${e}`,
      );
      return false;
    }
  }

  private async sendExpiredListerReminder(
    request: {
      id: string;
      productId: string;
      rentalDays: number | null;
      reminderState: unknown;
      product: { name: string } | null;
      requester: { name: string | null } | null;
      lister: { id: string; name: string | null; email: string | null } | null;
    },
    action: AvailabilityReminderAction,
    now: Date,
  ): Promise<boolean> {
    if (action.track !== 'expiredLister') return false;
    if (!request.lister?.id) return false;

    const productName = request.product?.name ?? 'this item';
    const requestType = this.requestType(request.rentalDays);
    const renterName = request.requester?.name || 'A renter';
    const { title, message } = expiredListerReminderCopy({
      productName,
      requestType,
      renterName,
      stage: action.stage,
    });
    const email = request.lister.email?.trim() || '';
    const orderLink = `${this.clientBase()}/listers/orders/${request.id}`;

    try {
      await this.notification.createNotification({
        userId: request.lister.id,
        title,
        message,
        type: 'AVAILABILITY_EXPIRED_LISTER_REMINDER',
        metadata: {
          requestId: request.id,
          productId: request.productId,
          stage: action.stage,
        },
        sendEmail: Boolean(email),
        emailData: {
          email,
          listerName: request.lister.name || 'there',
          renterName,
          productName,
          requestType,
          orderLink,
          stage: action.stage,
        },
      });

      const nextState = applyAvailabilityRequestReminderState(
        request.reminderState,
        action,
        now,
      );
      await this.prisma.availabilityRequest.update({
        where: { id: request.id },
        data: { reminderState: nextState },
      });
      request.reminderState = nextState;
      return true;
    } catch (e) {
      this.logger.error(
        `[AvailabilityReminders] expiredLister failed for ${request.id}: ${e}`,
      );
      return false;
    }
  }
}
