import type { NotificationService } from 'src/services/notification/notification.service';
import {
  buildRenterOrderPageUrl,
  getResaleInspectionPeriodLabel,
} from 'src/module/order/resale-delivery.util';

type ShipmentNotifyCtx = {
  id: string;
  type: string;
  trackingId?: string | null;
  order?: {
    orderId: string;
    user?: { id: string; name: string; email: string } | null;
  } | null;
};

/**
 * Renter/lister notifications when a shipment leg advances (carrier poll or admin manual).
 */
export async function sendShipmentLegStatusNotification(
  notification: NotificationService,
  shipment: ShipmentNotifyCtx,
  newStatus: string,
): Promise<void> {
  const order = shipment.order;
  const customer = order?.user;
  if (!customer?.id || !order?.orderId) return;

  const isOutbound = shipment.type === 'OUTBOUND';
  const isResale = shipment.type === 'RESALE';
  const isReturn = shipment.type === 'RETURN';

  if (newStatus === 'IN_TRANSIT') {
    const title = isResale
      ? 'Your purchase is in transit!'
      : isOutbound
        ? 'Your rental is in transit!'
        : 'Return pickup in progress';
    const message = isResale
      ? 'Your item has been picked up and is on its way to you.'
      : isOutbound
        ? 'Your item has been picked up and is on its way to you.'
        : 'The rider has picked up your item for return. It is on its way back to the lister.';

    await notification.createNotification({
      userId: customer.id,
      title,
      message,
      type: isResale
        ? 'SHIPMENT_IN_TRANSIT'
        : isOutbound
          ? 'SHIPMENT_IN_TRANSIT'
          : 'RETURN_IN_TRANSIT',
      metadata: {
        shipmentId: shipment.id,
        orderId: order.orderId,
      },
      sendEmail: true,
      emailData: {
        email: customer.email,
        userName: customer.name,
        orderId: order.orderId,
        status: isResale
          ? 'In Transit'
          : isOutbound
            ? 'In Transit'
            : 'Return Pickup In Progress',
        trackingNumber: shipment.trackingId ?? undefined,
        estimatedDelivery: undefined,
      },
    });
    return;
  }

  if (newStatus !== 'COMPLETED') return;

  if (isReturn) {
    await notification.createNotification({
      userId: customer.id,
      title: 'Return delivered to the lister',
      message:
        'Carrier tracking shows your return was delivered. The lister will inspect the item and confirm receipt in the app. You will be notified when your collateral is released after they complete confirmation.',
      type: 'RETURN_DELIVERED_TO_LISTER',
      metadata: {
        shipmentId: shipment.id,
        orderId: order.orderId,
      },
      sendEmail: true,
      emailData: {
        email: customer.email,
        userName: customer.name,
        orderId: order.orderId,
        status: 'Delivered to lister (pending lister confirmation)',
        emailSubject: 'Your return was delivered',
        emailHeading: 'Return delivered',
        trackingNumber: shipment.trackingId ?? undefined,
        extraNote:
          'Your rental is not fully closed until the lister confirms they received the item in the expected condition.',
      },
    });
    return;
  }

  const inspectionLabel = getResaleInspectionPeriodLabel();
  const orderPageUrl = isResale ? buildRenterOrderPageUrl(order.orderId) : undefined;
  const resaleDeliveredMessage = isResale
    ? `Your item was delivered. Confirm receipt in the app if everything is correct, or report a problem within ${inspectionLabel}. Otherwise we will complete the order and release payment to the seller automatically.`
    : 'Your item has been delivered. Enjoy your rental!';

  await notification.createNotification({
    userId: customer.id,
    title: isResale
      ? 'Your purchase has been delivered!'
      : 'Your rental has been delivered!',
    message: isResale
      ? `${resaleDeliveredMessage} Open your order: ${orderPageUrl}`
      : resaleDeliveredMessage,
    type: 'SHIPMENT_DELIVERED',
    metadata: {
      shipmentId: shipment.id,
      orderId: order.orderId,
      orderPageUrl,
      resaleInspectionHours: isResale ? getResaleInspectionPeriodLabel() : undefined,
    },
    sendEmail: true,
    emailData: {
      email: customer.email,
      userName: customer.name,
      orderId: order.orderId,
      status: 'Delivered',
      trackingNumber: shipment.trackingId ?? undefined,
      estimatedDelivery: undefined,
      ...(isResale
        ? {
            emailSubject: 'Your purchase was delivered: confirm receipt',
            emailHeading: 'Confirm your purchase',
            extraNote: resaleDeliveredMessage,
            orderPageUrl,
            ctaLabel: 'View order and confirm delivery',
          }
        : {}),
    },
  });
}
