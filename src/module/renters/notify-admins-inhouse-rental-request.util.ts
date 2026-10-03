import { MailService } from 'src/services/mail/mail.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { fetchAdminAlertRecipients } from '../shipment/shipment-admin-alert-recipients';

function adminRequestsLink(requestId?: string): string {
  const origin = (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const segment = process.env.ADMIN_SECRET_SEGMENT?.trim() || 'k340eol21';
  const base = `${origin}/admin/${segment}/requests`;
  if (requestId?.trim()) {
    return `${base}?requestId=${encodeURIComponent(requestId.trim())}`;
  }
  return base;
}

/** In-app + email alert when a renter submits a request on the inhouse lister account. */
export async function notifyAdminsInhouseRentalRequest(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  input: {
    requestId: string;
    productId: string;
    productName: string;
    renterName: string;
    renterEmail?: string | null;
    isResaleRequest: boolean;
    rentalDays: number;
    totalPrice: number;
    startDate?: string | null;
    endDate?: string | null;
  },
): Promise<number> {
  const admins = await fetchAdminAlertRecipients(prisma);
  const recipients = admins.filter((admin) => admin.email?.trim());
  if (recipients.length === 0) {
    console.warn(
      `[RentalRequest] No admin email recipients for inhouse request ${input.requestId}.`,
    );
    return 0;
  }

  const adminLink = adminRequestsLink(input.requestId);
  const requestKind = input.isResaleRequest ? 'purchase enquiry' : 'rental enquiry';
  const title = input.isResaleRequest
    ? 'New inhouse purchase enquiry'
    : 'New inhouse rental enquiry';
  const message = input.isResaleRequest
    ? `${input.renterName} asked about buying ${input.productName}.`
    : `${input.renterName} asked about renting ${input.productName}.`;
  const notificationType = input.isResaleRequest
    ? 'ADMIN_INHOUSE_PURCHASE_REQUEST'
    : 'ADMIN_INHOUSE_RENTAL_REQUEST';
  const totalFormatted = new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(input.totalPrice);

  await Promise.all(
    recipients.map(async (admin) => {
      await notificationService.createNotification({
        userId: admin.id,
        title,
        message,
        type: notificationType,
        metadata: {
          requestId: input.requestId,
          productId: input.productId,
          rentalDays: input.rentalDays,
          totalPrice: input.totalPrice,
        },
        sendEmail: false,
      });

      try {
        await mailService.sendAdminInhouseRentalRequestAlert({
          email: admin.email.trim(),
          adminName: admin.name || 'Admin',
          requestKind,
          productName: input.productName,
          renterName: input.renterName,
          renterEmail: input.renterEmail?.trim() || undefined,
          rentalDays: input.rentalDays,
          totalAmountFormatted: totalFormatted,
          startDate: input.startDate || undefined,
          endDate: input.endDate || undefined,
          adminLink,
        });
      } catch (err) {
        console.error(
          `[RentalRequest] Admin alert email to ${admin.email} failed for ${input.requestId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  return recipients.length;
}
