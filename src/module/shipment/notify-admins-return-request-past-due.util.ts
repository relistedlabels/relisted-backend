import { MailService } from 'src/services/mail/mail.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { fetchAdminAlertRecipients } from './shipment-admin-alert-recipients';

function adminOrdersLink(orderId: string): string {
  const origin = (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const segment = process.env.ADMIN_SECRET_SEGMENT?.trim() || 'k340eol21';
  return `${origin}/admin/${segment}/orders?orderId=${encodeURIComponent(orderId.trim())}`;
}

/** In-app + email alert when a return window passed and the renter has not submitted a return request. */
export async function notifyAdminsReturnRequestPastDue(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  input: {
    orderId: string;
    humanOrderId: string;
    shipmentId: string;
    productName: string;
    renterName: string;
    renterEmail: string;
    listerName: string;
    windowLabel: string;
    daysPastDue: number;
  },
): Promise<number> {
  const admins = await fetchAdminAlertRecipients(prisma);
  const recipients = admins.filter((admin) => admin.email?.trim());
  if (recipients.length === 0) {
    console.warn(
      `[ReturnRequestPastDue] No admin email recipients for overdue return on order ${input.humanOrderId}.`,
    );
    return 0;
  }

  const adminLink = adminOrdersLink(input.orderId);
  const dayLabel =
    input.daysPastDue === 1
      ? '1 day overdue'
      : `${input.daysPastDue} days overdue`;
  const windowPart = input.windowLabel
    ? ` Pickup window was ${input.windowLabel}.`
    : '';

  await Promise.all(
    recipients.map(async (admin) => {
      await notificationService.createNotification({
        userId: admin.id,
        title: 'Overdue return request',
        message: `Order ${input.humanOrderId}: ${input.renterName} has not submitted a return request for ${input.productName}.${windowPart} ${dayLabel}. Follow up with the renter.`,
        type: 'ADMIN_RETURN_REQUEST_PAST_DUE',
        metadata: {
          orderId: input.orderId,
          orderNumber: input.humanOrderId,
          shipmentId: input.shipmentId,
          daysPastDue: input.daysPastDue,
          renterEmail: input.renterEmail,
        },
        sendEmail: false,
      });

      try {
        await mailService.sendAdminReturnRequestPastDueAlert({
          email: admin.email.trim(),
          adminName: admin.name || 'Admin',
          humanOrderId: input.humanOrderId,
          productName: input.productName,
          renterName: input.renterName,
          renterEmail: input.renterEmail,
          listerName: input.listerName,
          windowLabel: input.windowLabel,
          daysPastDue: input.daysPastDue,
          adminLink,
        });
      } catch (err) {
        console.error(
          `[ReturnRequestPastDue] Admin alert email to ${admin.email} failed for ${input.humanOrderId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  return recipients.length;
}
