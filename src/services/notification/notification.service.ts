import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async createNotification(dto: {
    userId: string;
    title: string;
    message: string;
    type: string;
    metadata?: any;
    sendEmail?: boolean;
    emailData?: any;
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

    // 2. Handle Email if requested
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

  async markAsRead(notificationId: string) {
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async getUserNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
