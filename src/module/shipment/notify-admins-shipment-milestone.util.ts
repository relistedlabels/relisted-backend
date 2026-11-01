import { MailService } from 'src/services/mail/mail.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { buildAdminShipmentsPageUrl } from './build-admin-shipments-page-url';
import { fetchAdminAlertRecipients } from './shipment-admin-alert-recipients';

export type ShipmentAdminMilestoneInput = {
  shipmentId: string;
  humanOrderId: string;
  legLabel: string;
  renterName?: string;
  renterEmail?: string;
  productNames?: string[];
  trackingUrl?: string;
  trackingId?: string;
};

async function notifyAdminsShipmentMilestone(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  kind: 'booked' | 'delivered',
  input: ShipmentAdminMilestoneInput,
): Promise<number> {
  const admins = await fetchAdminAlertRecipients(prisma);
  if (admins.length === 0) {
    console.warn(
      `[Shipment] No admin recipients for ${kind} alert (shipment ${input.shipmentId}).`,
    );
    return 0;
  }

  const adminShipmentUrl =
    buildAdminShipmentsPageUrl({ shipmentId: input.shipmentId }) || undefined;

  const title =
    kind === 'booked' ? 'Shipment booked' : 'Shipment delivered';
  const message =
    kind === 'booked'
      ? `Order ${input.humanOrderId}: ${input.legLabel} is booked with the carrier.`
      : `Order ${input.humanOrderId}: ${input.legLabel} was delivered.`;
  const type =
    kind === 'booked' ? 'ADMIN_SHIPMENT_BOOKED' : 'ADMIN_SHIPMENT_DELIVERED';

  for (const admin of admins) {
    await notificationService.createNotification({
      userId: admin.id,
      title,
      message,
      type,
      metadata: {
        shipmentId: input.shipmentId,
        orderId: input.humanOrderId,
        legLabel: input.legLabel,
      },
      sendEmail: false,
    });
  }

  for (const admin of admins) {
    if (!admin.email?.trim()) continue;
    try {
      if (kind === 'booked') {
        await mailService.sendAdminShipmentBookedAlert({
          to: admin.email.trim(),
          humanOrderId: input.humanOrderId,
          legLabel: input.legLabel,
          renterName: input.renterName,
          renterEmail: input.renterEmail,
          productNames: input.productNames,
          trackingUrl: input.trackingUrl,
          trackingId: input.trackingId,
          adminShipmentUrl,
        });
      } else {
        await mailService.sendAdminShipmentDeliveredAlert({
          to: admin.email.trim(),
          humanOrderId: input.humanOrderId,
          legLabel: input.legLabel,
          renterName: input.renterName,
          renterEmail: input.renterEmail,
          productNames: input.productNames,
          trackingUrl: input.trackingUrl,
          adminShipmentUrl,
        });
      }
    } catch (err) {
      console.error(
        `[Shipment] Admin ${kind} email to ${admin.email} failed for ${input.humanOrderId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return admins.length;
}

/** In-app + email when carrier booking succeeds. */
export async function notifyAdminsShipmentBooked(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  input: ShipmentAdminMilestoneInput,
): Promise<number> {
  return notifyAdminsShipmentMilestone(
    prisma,
    notificationService,
    mailService,
    'booked',
    input,
  );
}

/** In-app + email when carrier tracking shows delivery. */
export async function notifyAdminsShipmentDelivered(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  input: ShipmentAdminMilestoneInput,
): Promise<number> {
  return notifyAdminsShipmentMilestone(
    prisma,
    notificationService,
    mailService,
    'delivered',
    input,
  );
}
