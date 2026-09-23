import type { PrismaService } from 'src/services/prisma/prisma.service';
import type { NotificationService } from 'src/services/notification/notification.service';
import { returnLegItemPreviews } from 'src/module/order/return-request-leg.util';
import { PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY } from 'src/utils/product-attachment-upload-order';
import { getListerReturnInspectionPeriodLabel } from 'src/module/order/rental-delivery.util';
import { buildShippingEmailTrackingFields } from './shipment-tracking-url.util';

export type ListerReturnLegNotifyCtx = {
  id: string;
  listerId?: string | null;
  orderId?: string;
  type?: string;
  trackingId?: string | null;
  pricingTier?: string | null;
  providerTrackingUrl?: string | null;
  providerShipmentId?: string | null;
  order?: { id?: string; orderId?: string } | null;
};

/**
 * Lister emails when a RETURN leg advances (carrier tracking or admin manual completion).
 */
export async function notifyListersForReturnLeg(
  prisma: PrismaService,
  notification: NotificationService,
  shipment: ListerReturnLegNotifyCtx,
  phase: 'IN_TRANSIT' | 'COMPLETED',
): Promise<void> {
  if (shipment.type && shipment.type !== 'RETURN') return;

  const orderInternalId = shipment.order?.id ?? shipment.orderId;
  if (!orderInternalId) return;

  const full = await prisma.order.findUnique({
    where: { id: orderInternalId },
    select: {
      id: true,
      orderId: true,
      orderItems: {
        select: {
          returnShipmentId: true,
          imageUrl: true,
          product: {
            select: {
              name: true,
              attachments: {
                select: {
                  uploads: {
                    take: 1,
                    orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                    select: { url: true },
                  },
                },
              },
              curator: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                  profile: {
                    select: {
                      businessInfo: { select: { businessName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!full) return;

  const clientUrl = process.env.CLIENT_URL || 'https://relisted.com';
  const orderPageUrl = `${clientUrl}/listers/orders/${full.id}`;
  const trackingFields = buildShippingEmailTrackingFields(shipment);

  const listerId = shipment.listerId;
  if (!listerId) return;

  const lister = full.orderItems
    .map((oi) => oi.product?.curator)
    .find((c) => c?.id === listerId);
  if (!lister?.email?.trim()) return;

  const curatorName =
    lister.profile?.businessInfo?.businessName || lister.name || 'there';

  if (phase === 'IN_TRANSIT') {
    await notification.createNotification({
      userId: listerId,
      title: 'Return on its way to you',
      message: `The renter's return for order ${full.orderId} is in transit to your address.`,
      type: 'LISTER_RETURN_IN_TRANSIT',
      metadata: {
        orderId: full.id,
        orderNumber: full.orderId,
        shipmentId: shipment.id,
      },
      sendEmail: true,
      emailData: {
        email: lister.email.trim(),
        curatorName,
        orderNumber: full.orderId,
        orderPageUrl,
        platformName: 'Relisted',
        ...trackingFields,
      },
    });
    return;
  }

  const autoConfirmPeriodLabel = getListerReturnInspectionPeriodLabel();
  const returnItems = returnLegItemPreviews(
    full.orderItems,
    shipment.id,
    listerId,
  );
  await notification.createNotification({
    userId: listerId,
    title: 'Confirm return receipt to finish this rental',
    message: `The return for order ${full.orderId} was delivered. Confirm receipt in the app to complete the order. If you don't confirm within ${autoConfirmPeriodLabel}, we'll automatically complete it and release funds.`,
    type: 'LISTER_RETURN_DELIVERED_CONFIRM',
    metadata: {
      orderId: full.id,
      orderNumber: full.orderId,
      shipmentId: shipment.id,
    },
    sendEmail: true,
    emailData: {
      email: lister.email.trim(),
      curatorName,
      orderNumber: full.orderId,
      orderPageUrl,
      platformName: 'Relisted',
      trackingNumber: trackingFields.trackingNumber,
      autoConfirmPeriodLabel,
      returnItems,
    },
  });
}
