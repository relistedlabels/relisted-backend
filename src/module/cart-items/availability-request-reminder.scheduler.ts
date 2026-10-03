import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AvailabilityStatus } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import {
  applyAvailabilityRequestReminderState,
  checkoutReminderBatchCopy,
  computeCheckoutReminderActions,
  computeExpiredListerReminderActions,
  expiredListerReminderBatchCopy,
  type AvailabilityReminderAction,
  type CheckoutReminderItem,
  type CheckoutReminderStage,
  type ExpiredListerReminderItem,
  type ExpiredListerReminderStage,
} from './availability-request-reminder.util';
import {
  findSupersedingOrderProductRequesterPairs,
  isAvailabilityRequestSupersededByActiveOrder,
  markSupersededAvailabilityRequestsOrdered,
} from './fulfill-availability-for-checkout';
import {
  canListerActOnAvailabilityRequest,
  isBusinessExpired,
} from 'src/utils/availability-request-expiry.util';

const AVAILABILITY_REMINDER_CRON =
  process.env.AVAILABILITY_REQUEST_REMINDER_CRON?.trim() || '*/5 * * * *';

/** Only remind on requests in this recent window (ignore historical expired/approved rows). */
const REMINDER_LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.AVAILABILITY_REQUEST_REMINDER_LOOKBACK_DAYS ?? 3),
);

type AcceptedRequest = {
  id: string;
  productId: string;
  rentalDays: number | null;
  approvedAt: Date | null;
  reminderState: unknown;
  product: { name: string } | null;
  requester: { id: string; name: string | null; email: string | null } | null;
  lister: { name: string | null } | null;
};

type ExpiredRequest = {
  id: string;
  productId: string;
  rentalDays: number | null;
  expiresAt: Date | null;
  reminderState: unknown;
  product: { name: string } | null;
  requester: { id: string; name: string | null } | null;
  lister: { id: string; name: string | null; email: string | null } | null;
};

type CheckoutBatchEntry = {
  request: AcceptedRequest;
  action: AvailabilityReminderAction & { track: 'checkout' };
};

type ExpiredListerBatchEntry = {
  request: ExpiredRequest;
  action: AvailabilityReminderAction & { track: 'expiredLister' };
};

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

  private checkoutBatchKey(requesterId: string, stage: CheckoutReminderStage) {
    return `${requesterId}:${stage}`;
  }

  private expiredListerBatchKey(
    listerId: string,
    stage: ExpiredListerReminderStage,
  ) {
    return `${listerId}:${stage}`;
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

    const supersededPairs = await findSupersedingOrderProductRequesterPairs(
      this.prisma,
      accepted.map((request) => ({
        productId: request.productId,
        requesterId: request.requester?.id ?? '',
      })),
    );

    if (supersededPairs.size > 0) {
      await markSupersededAvailabilityRequestsOrdered(
        this.prisma,
        accepted.map((request) => ({
          id: request.id,
          productId: request.productId,
          requesterId: request.requester?.id ?? '',
        })),
        supersededPairs,
      );
    }

    const checkoutBatches = new Map<string, CheckoutBatchEntry[]>();

    for (const request of accepted) {
      const requesterId = request.requester?.id ?? '';
      if (
        !requesterId ||
        isAvailabilityRequestSupersededByActiveOrder(supersededPairs, {
          productId: request.productId,
          requesterId,
        })
      ) {
        continue;
      }

      const actions = computeCheckoutReminderActions(
        now,
        request.approvedAt,
        request.reminderState,
      );
      for (const action of actions) {
        if (action.track !== 'checkout') continue;
        const key = this.checkoutBatchKey(requesterId, action.stage);
        const batch = checkoutBatches.get(key) ?? [];
        batch.push({ request, action });
        checkoutBatches.set(key, batch);
      }
    }

    for (const batch of checkoutBatches.values()) {
      const ok = await this.sendCheckoutReminderBatch(batch, now);
      if (ok) checkoutSent += 1;
    }

    const expired = await this.prisma.availabilityRequest.findMany({
      where: {
        status: AvailabilityStatus.EXPIRED,
        expiresAt: { gte: since },
      },
      include: {
        product: { select: { name: true } },
        requester: { select: { id: true, name: true } },
        lister: { select: { id: true, name: true, email: true } },
      },
      take: 200,
      orderBy: { expiresAt: 'asc' },
    });

    const activeOrderPairs = await findSupersedingOrderProductRequesterPairs(
      this.prisma,
      expired.map((request) => ({
        productId: request.productId,
        requesterId: request.requester?.id ?? '',
      })),
    );

    const expiredListerBatches = new Map<string, ExpiredListerBatchEntry[]>();

    for (const request of expired) {
      if (
        isAvailabilityRequestSupersededByActiveOrder(activeOrderPairs, {
          productId: request.productId,
          requesterId: request.requester?.id ?? '',
        })
      ) {
        continue;
      }
      if (
        isBusinessExpired(request, now) ||
        !canListerActOnAvailabilityRequest(request, now)
      ) {
        continue;
      }

      const actions = computeExpiredListerReminderActions(
        now,
        request.expiresAt,
        request.reminderState,
      );
      for (const action of actions) {
        if (action.track !== 'expiredLister') continue;
        if (!request.lister?.id) continue;
        const key = this.expiredListerBatchKey(request.lister.id, action.stage);
        const batch = expiredListerBatches.get(key) ?? [];
        batch.push({ request, action });
        expiredListerBatches.set(key, batch);
      }
    }

    for (const batch of expiredListerBatches.values()) {
      const ok = await this.sendExpiredListerReminderBatch(batch, now);
      if (ok) expiredListerSent += 1;
    }

    if (checkoutSent || expiredListerSent) {
      this.logger.log(
        `[AvailabilityReminders] checkout=${checkoutSent}, expiredLister=${expiredListerSent}`,
      );
    }
  }

  private async sendCheckoutReminderBatch(
    batch: CheckoutBatchEntry[],
    now: Date,
  ): Promise<boolean> {
    if (batch.length === 0) return false;

    const requester = batch[0].request.requester;
    if (!requester?.id) return false;

    const stage = batch[0].action.stage;
    const items: CheckoutReminderItem[] = batch.map(({ request }) => ({
      productName: request.product?.name ?? 'this item',
      requestType: this.requestType(request.rentalDays),
      listerName: request.lister?.name || 'The curator',
    }));
    const { title, message, requestType } = checkoutReminderBatchCopy({
      items,
      stage,
    });
    const email = requester.email?.trim() || '';
    const cartLink = `${this.clientBase()}/shop/cart`;
    const emailData =
      items.length === 1
        ? {
            email,
            userName: requester.name || 'there',
            title,
            listerName: items[0].listerName,
            productName: items[0].productName,
            requestType,
            cartLink,
            stage,
          }
        : {
            email,
            userName: requester.name || 'there',
            title,
            requestType,
            cartLink,
            stage,
            items,
          };

    try {
      await this.notification.createNotification({
        userId: requester.id,
        title,
        message,
        type: 'AVAILABILITY_CHECKOUT_REMINDER',
        metadata: {
          batch: items.length > 1,
          requestIds: batch.map(({ request }) => request.id),
          productIds: batch.map(({ request }) => request.productId),
          stage,
        },
        sendEmail: Boolean(email),
        emailData,
      });

      for (const { request, action } of batch) {
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
      }

      return true;
    } catch (e) {
      this.logger.error(
        `[AvailabilityReminders] checkout batch failed for ${requester.id}: ${e}`,
      );
      return false;
    }
  }

  private async sendExpiredListerReminderBatch(
    batch: ExpiredListerBatchEntry[],
    now: Date,
  ): Promise<boolean> {
    if (batch.length === 0) return false;

    const lister = batch[0].request.lister;
    if (!lister?.id) return false;

    const stage = batch[0].action.stage;
    const clientBase = this.clientBase();
    const items: ExpiredListerReminderItem[] = batch.map(({ request }) => ({
      productName: request.product?.name ?? 'this item',
      requestType: this.requestType(request.rentalDays),
      renterName: request.requester?.name || 'A renter',
      orderLink: `${clientBase}/listers/orders/${request.id}`,
    }));
    const { title, message, requestType } = expiredListerReminderBatchCopy({
      items,
      stage,
    });
    const email = lister.email?.trim() || '';
    const emailData =
      items.length === 1
        ? {
            email,
            listerName: lister.name || 'there',
            title,
            renterName: items[0].renterName,
            productName: items[0].productName,
            requestType,
            orderLink: items[0].orderLink,
            stage,
          }
        : {
            email,
            listerName: lister.name || 'there',
            title,
            requestType,
            ordersLink: `${clientBase}/listers/orders`,
            stage,
            items,
          };

    try {
      await this.notification.createNotification({
        userId: lister.id,
        title,
        message,
        type: 'AVAILABILITY_EXPIRED_LISTER_REMINDER',
        metadata: {
          batch: items.length > 1,
          requestIds: batch.map(({ request }) => request.id),
          productIds: batch.map(({ request }) => request.productId),
          stage,
        },
        sendEmail: Boolean(email),
        emailData,
      });

      for (const { request, action } of batch) {
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
      }

      return true;
    } catch (e) {
      this.logger.error(
        `[AvailabilityReminders] expiredLister batch failed for ${lister.id}: ${e}`,
      );
      return false;
    }
  }
}
