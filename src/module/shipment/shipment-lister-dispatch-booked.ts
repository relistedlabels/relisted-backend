import type { PrismaService } from 'src/services/prisma/prisma.service';
import type { NotificationService } from 'src/services/notification/notification.service';
import { formatDispatchWindowLagos } from './dispatch-window-format';

export type ListerDispatchBookedNotifyCtx = {
  id: string;
  listerId?: string | null;
  orderId?: string;
  type?: string;
  scheduledWindowStart?: Date | string | null;
  scheduledWindowEnd?: Date | string | null;
  order?: { id?: string; orderId?: string } | null;
};

/**
 * Lister ping when a pickup leg (OUTBOUND/RESALE) is booked with the carrier:
 * the rider collects from the lister, so they need the pickup window.
 */
export async function notifyListerOfDispatchBooking(
  prisma: PrismaService,
  notification: NotificationService,
  shipment: ListerDispatchBookedNotifyCtx,
): Promise<void> {
  if (shipment.type !== 'OUTBOUND' && shipment.type !== 'RESALE') return;
  if (!shipment.listerId) return;

  const orderInternalId = shipment.order?.id ?? shipment.orderId;
  if (!orderInternalId) return;

  const full = await prisma.order.findUnique({
    where: { id: orderInternalId },
    select: { id: true, orderId: true },
  });
  if (!full) return;

  const lister = await prisma.user.findUnique({
    where: { id: shipment.listerId },
    select: {
      email: true,
      name: true,
      profile: {
        select: { businessInfo: { select: { businessName: true } } },
      },
    },
  });
  if (!lister?.email?.trim()) return;

  const curatorName =
    lister.profile?.businessInfo?.businessName || lister.name || 'there';

  const wStart = shipment.scheduledWindowStart
    ? new Date(shipment.scheduledWindowStart)
    : null;
  const wEnd = shipment.scheduledWindowEnd
    ? new Date(shipment.scheduledWindowEnd)
    : null;
  const windowSummary =
    wStart && wEnd ? formatDispatchWindowLagos(wStart, wEnd) : '';

  const clientUrl = process.env.CLIENT_URL || 'https://relisted.com';
  const orderPageUrl = `${clientUrl}/listers/orders/${full.id}`;

  await notification.createNotification({
    userId: shipment.listerId,
    title: '📦 Dispatch booked. Get your item ready.',
    message: `The courier is booked for order ${full.orderId}.${windowSummary ? ` Pickup window: ${windowSummary}.` : ''} Have your item packed and ready for pickup. You’ll get another update when the rider collects it.`,
    type: 'LISTER_DISPATCH_BOOKED',
    metadata: {
      orderId: full.id,
      orderNumber: full.orderId,
      shipmentId: shipment.id,
    },
    sendEmail: true,
    emailData: {
      email: lister.email.trim(),
      userName: curatorName,
      orderId: full.orderId,
      status: 'Booked for dispatch (pickup not started yet)',
      emailSubject: 'Dispatch booked. Get your item ready.',
      emailHeading: 'Dispatch booked with courier',
      ...(windowSummary ? { pickupWindowSummary: windowSummary } : {}),
      extraNote:
        'The courier is booked for this window. The rider may not have picked up yet. Have your item packed and ready.',
      orderPageUrl,
      ctaLabel: 'View order',
    },
  });
}
