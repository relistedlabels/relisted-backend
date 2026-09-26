import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  WhatsAppOutbound,
  WhatsAppService,
} from '../whatsapp/whatsapp.service';

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 30;
export const NOTIFICATION_LIST_MAX_LIMIT = 50;
export const NOTIFICATION_DEFAULT_DAYS = 30;

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsAppService,
  ) {}

  async createNotification(dto: {
    userId: string;
    title: string;
    message: string;
    type: string;
    metadata?: any;
    sendEmail?: boolean;
    emailData?: any;
    whatsapp?: WhatsAppOutbound;
  }) {
    const { userId, title, message, type, metadata, sendEmail, emailData } =
      dto;

    // 1. Create In-App Notification
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        metadata: metadata || {},
      },
    });

    // 2. Handle WhatsApp if requested
    if (dto.whatsapp) {
      await this.dispatchWhatsApp(dto.whatsapp);
    }

    // 3. Handle Email if requested
    if (sendEmail) {
      if (
        type === 'DISPUTE_CREATED' ||
        type === 'DISPUTE_STATUS' ||
        type === 'ADMIN_WITHDRAWAL_REQUEST'
      ) {
        await this.triggerEmail(type, emailData);
        return notification;
      }

      // Check user notification settings
      const settings = await this.prisma.notificationSettings.findUnique({
        where: { userId },
      });

      if (!settings || settings.emailAlertsEnabled) {
        await this.triggerEmail(type, emailData);
      }
    }

    return notification;
  }

  private async dispatchWhatsApp(outbound: WhatsAppOutbound) {
    switch (outbound.kind) {
      case 'lister_availability':
        await this.whatsappService.sendListerAvailabilityRequest(
          outbound.params,
        );
        break;
      case 'lister_purchase':
        await this.whatsappService.sendListerPurchaseRequest(outbound.params);
        break;
      case 'renter_return_reminder':
        await this.whatsappService.sendRenterReturnReminder(outbound.params);
        break;
    }
  }

  private async triggerEmail(type: string, data: any) {
    try {
      switch (type) {
        case 'RENTAL_REQUEST':
        case 'PURCHASE_REQUEST':
          await this.mailService.SendRentalRequestMail(data);
          break;
        case 'RENTAL_ACCEPTED':
        case 'RENTAL_REJECTED':
        case 'RENTAL_RESPONSE':
          await this.mailService.SendRentalResponseMail(data);
          break;
        case 'AVAILABILITY_REQUEST_REMINDER':
          await this.mailService.sendAvailabilityRequestReminderMail(data);
          break;
        case 'AVAILABILITY_CHECKOUT_REMINDER':
          await this.mailService.sendAvailabilityCheckoutReminderMail(data);
          break;
        case 'AVAILABILITY_EXPIRED_LISTER_REMINDER':
          await this.mailService.sendAvailabilityExpiredListerReminderMail(
            data,
          );
          break;
        case 'ORDER_CONFIRMATION':
          await this.mailService.SendVerificationOrderMail(data);
          break;
        case 'ORDER_CONFIRMED':
          await this.mailService.SendVerificationOrderMail(data);
          break;
        case 'ORDER_CANCELLED':
          await this.mailService.sendOrderCancelledMail(data);
          break;
        case 'WITHDRAWAL_REQUEST':
        case 'WITHDRAWAL_APPROVED':
        case 'WITHDRAWAL_REJECTED':
        case 'WITHDRAWAL_STATUS':
          await this.mailService.SendWithdrawalMail(data);
          break;
        case 'RENTAL_REQUEST_SENT':
        case 'PURCHASE_REQUEST_SENT':
          // No email for this one usually, but we check just in case
          break;
        case 'SHIPMENT_DISPATCHED':
        case 'RETURN_DISPATCHED':
        case 'RETURN_PICKUP_SCHEDULED':
        case 'RETURN_REQUEST_SUBMITTED':
          await this.mailService.SendShippingUpdateMail(data);
          break;
        case 'SHIPMENT_IN_TRANSIT':
        case 'RETURN_IN_TRANSIT':
          await this.mailService.SendShippingUpdateMail(data);
          break;
        case 'RETURN_DELIVERED_TO_LISTER':
          await this.mailService.SendShippingUpdateMail(data);
          break;
        case 'SHIPMENT_DELIVERED':
        case 'RETURN_CONFIRMED':
          await this.mailService.SendShippingUpdateMail(data);
          break;
        case 'LISTER_RETURN_IN_TRANSIT':
          await this.mailService.SendListerReturnInTransitMail(data);
          break;
        case 'LISTER_RETURN_DELIVERED_CONFIRM':
          await this.mailService.SendListerReturnDeliveredConfirmMail(data);
          break;
        case 'LISTER_RETURN_WINDOW_PASSED':
          await this.mailService.SendListerReturnWindowPassedMail(data);
          break;
        case 'RETURN_DUE_REMINDER':
          await this.mailService.sendReturnDueReminderMail(data);
          break;
        case 'RETURN_REQUEST_REMINDER':
          await this.mailService.sendReturnRequestReminderMail(data);
          break;
        case 'SHIPPING_UPDATE':
          await this.mailService.SendShippingUpdateMail(data);
          break;
        case 'RETURN_INITIATED':
          await this.mailService.SendReturnInitiatedMail(data);
          break;
        case 'RETURN_COMPLETED':
          await this.mailService.SendReturnCompletedMail(data);
          break;
        case 'DISPUTE_CREATED':
          await this.mailService.SendDisputeCreatedMail(data);
          break;
        case 'DISPUTE_STATUS':
          await this.mailService.SendDisputeStatusMail(data);
          break;
        case 'DISPUTE_MESSAGE':
          await this.mailService.SendDisputeMessageMail(data);
          break;
        case 'ESCROW_RELEASE':
          await this.mailService.sendEscrowReleaseNotification(data);
          break;
        case 'WALLET_FUNDED':
          await this.mailService.sendWalletFundedEmail(data);
          break;
        case 'ADMIN_WITHDRAWAL_REQUEST':
          await this.mailService.sendAdminWithdrawalRequestAlert(data);
          break;
        default:
          console.warn(`No mail handler for notification type: ${type}`);
      }
    } catch (error) {
      console.error(`Failed to send email for ${type}:`, error);
    }
  }

  private getSinceDate(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return since;
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string, days = NOTIFICATION_DEFAULT_DAYS) {
    const since = this.getSinceDate(days);
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false, createdAt: { gte: since } },
      data: { isRead: true },
    });
    return result.count;
  }

  async getUnreadCount(userId: string, days = NOTIFICATION_DEFAULT_DAYS) {
    const since = this.getSinceDate(days);
    return this.prisma.notification.count({
      where: { userId, isRead: false, createdAt: { gte: since } },
    });
  }

  async getUserNotifications(
    userId: string,
    options?: { limit?: number; page?: number; days?: number },
  ) {
    const limit = Math.min(
      options?.limit ?? NOTIFICATION_LIST_DEFAULT_LIMIT,
      NOTIFICATION_LIST_MAX_LIMIT,
    );
    const page = Math.max(options?.page ?? 1, 1);
    const days = options?.days ?? NOTIFICATION_DEFAULT_DAYS;
    const since = this.getSinceDate(days);

    const where = {
      userId,
      createdAt: { gte: since },
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { ...where, isRead: false },
      }),
    ]);

    return {
      items,
      total,
      unreadCount,
      page,
      limit,
      days,
      hasMore: page * limit < total,
    };
  }
}
