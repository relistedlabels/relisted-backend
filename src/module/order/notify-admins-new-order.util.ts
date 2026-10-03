import { MailService } from 'src/services/mail/mail.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { fetchAdminAlertRecipients } from '../shipment/shipment-admin-alert-recipients';

function adminOrdersLink(orderId?: string): string {
  const origin = (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const segment = process.env.ADMIN_SECRET_SEGMENT?.trim() || 'k340eol21';
  const base = `${origin}/admin/${segment}/orders`;
  if (orderId?.trim()) {
    return `${base}?orderId=${encodeURIComponent(orderId.trim())}`;
  }
  return base;
}

/** In-app + email alert when a renter completes checkout. */
export async function notifyAdminsNewOrder(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  input: {
    orderId: string;
    humanOrderId: string;
    renterName: string;
    renterEmail: string;
    listerNames: string[];
    itemCount: number;
    productNames?: string[];
    totalAmount: number;
  },
): Promise<number> {
  const admins = await fetchAdminAlertRecipients(prisma);
  const recipients = admins.filter((admin) => admin.email?.trim());
  if (recipients.length === 0) {
    console.warn(
      `[Order] No admin email recipients for new order ${input.humanOrderId}.`,
    );
    return 0;
  }

  const adminLink = adminOrdersLink(input.orderId);
  const totalFormatted = new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(input.totalAmount);
  const listerSummary =
    input.listerNames.length > 0
      ? input.listerNames.join(', ')
      : 'Unknown lister';
  const itemLabel = input.itemCount === 1 ? '1 item' : `${input.itemCount} items`;

  await Promise.all(
    recipients.map(async (admin) => {
      await notificationService.createNotification({
        userId: admin.id,
        title: 'New order',
        message: `Order ${input.humanOrderId} from ${input.renterName}. ${itemLabel}, NGN ${totalFormatted}.`,
        type: 'ADMIN_NEW_ORDER',
        metadata: {
          orderId: input.orderId,
          orderNumber: input.humanOrderId,
          itemCount: input.itemCount,
          totalAmount: input.totalAmount,
        },
        sendEmail: false,
      });

      try {
        await mailService.sendAdminNewOrderAlert({
          email: admin.email.trim(),
          adminName: admin.name || 'Admin',
          humanOrderId: input.humanOrderId,
          renterName: input.renterName,
          renterEmail: input.renterEmail,
          listerSummary,
          itemCount: input.itemCount,
          productNames: input.productNames,
          totalAmountFormatted: totalFormatted,
          adminLink,
        });
      } catch (err) {
        console.error(
          `[Order] Admin alert email to ${admin.email} failed for ${input.humanOrderId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  return recipients.length;
}
