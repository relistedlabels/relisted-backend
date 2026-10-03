import { MailService } from 'src/services/mail/mail.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { fetchAdminAlertRecipients } from '../shipment/shipment-admin-alert-recipients';

function adminOrdersLink(): string {
  const origin = (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const segment = process.env.ADMIN_SECRET_SEGMENT?.trim() || 'k340eol21';
  return `${origin}/admin/${segment}/orders`;
}

/** In-app + email alert when an admin cancels an order. */
export async function notifyAdminsOrderCancelled(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  input: {
    orderId: string;
    humanOrderId: string;
    renterName: string;
    renterEmail: string;
    listerNames: string[];
    productNames?: string[];
    refundAmount: number;
    reason: string;
    cancelledAt: Date;
  },
): Promise<number> {
  const admins = await fetchAdminAlertRecipients(prisma);
  const recipients = admins.filter((admin) => admin.email?.trim());
  if (recipients.length === 0) {
    console.warn(
      `[OrderCancel] No admin email recipients for cancelled order ${input.humanOrderId}.`,
    );
    return 0;
  }

  const adminLink = adminOrdersLink();
  const refundFormatted = new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(input.refundAmount);
  const listerSummary =
    input.listerNames.length > 0
      ? input.listerNames.join(', ')
      : 'Unknown lister';

  await Promise.all(
    recipients.map(async (admin) => {
      await notificationService.createNotification({
        userId: admin.id,
        title: 'Order cancelled',
        message: `Order ${input.humanOrderId} was cancelled. NGN ${refundFormatted} refunded to ${input.renterName}.`,
        type: 'ADMIN_ORDER_CANCELLED',
        metadata: {
          orderId: input.orderId,
          orderNumber: input.humanOrderId,
          refundAmount: input.refundAmount,
          reason: input.reason,
        },
        sendEmail: false,
      });

      try {
        await mailService.sendAdminOrderCancelledAlert({
          email: admin.email.trim(),
          adminName: admin.name || 'Admin',
          humanOrderId: input.humanOrderId,
          renterName: input.renterName,
          renterEmail: input.renterEmail,
          listerSummary,
          productNames: input.productNames,
          refundAmountFormatted: refundFormatted,
          reason: input.reason,
          cancelledAt: input.cancelledAt.toISOString(),
          adminLink,
        });
      } catch (err) {
        console.error(
          `[OrderCancel] Admin alert email to ${admin.email} failed for ${input.humanOrderId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  return recipients.length;
}
