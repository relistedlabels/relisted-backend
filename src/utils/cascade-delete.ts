import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type PrismaTx = Prisma.TransactionClient;

/**
 * Removes an order and all FK-dependent rows (shipments, disputes, rentals, etc.).
 * Mirrors cleanup-order.ts ordering with shipment leg nullification first.
 */
export async function deleteOrderCascade(
  tx: PrismaTx,
  orderId: string,
): Promise<void> {
  await tx.orderItem.updateMany({
    where: { orderId },
    data: {
      outboundShipmentId: null,
      returnShipmentId: null,
      resaleShipmentId: null,
    },
  });

  await tx.returnRequest.deleteMany({ where: { orderId } });

  const shipments = await tx.shipment.findMany({
    where: { orderId },
    select: { id: true },
  });
  for (const shipment of shipments) {
    await tx.dispatchAttemptLog.deleteMany({
      where: { shipmentId: shipment.id },
    });
  }
  await tx.shipment.deleteMany({ where: { orderId } });

  const rentals = await tx.rental.findMany({
    where: { orderId },
    select: { id: true },
  });
  if (rentals.length > 0) {
    await tx.review.deleteMany({
      where: { rentalId: { in: rentals.map((r) => r.id) } },
    });
  }
  await tx.rental.deleteMany({ where: { orderId } });

  await tx.orderLister.deleteMany({ where: { orderId } });
  await tx.walletTransaction.deleteMany({ where: { orderId } });
  await tx.transaction.deleteMany({ where: { orderId } });
  await tx.virtualAccount.deleteMany({ where: { orderId } });
  await tx.escrow.deleteMany({ where: { orderId } });

  const disputes = await tx.dispute.findMany({
    where: { orderId },
    select: { id: true },
  });
  for (const dispute of disputes) {
    const chatRoom = await tx.chatRoom.findUnique({
      where: { disputeId: dispute.id },
    });
    if (chatRoom) {
      await tx.message.deleteMany({ where: { chatRoomId: chatRoom.id } });
      await tx.chatRoom.delete({ where: { id: chatRoom.id } });
    }
    await tx.attachments.updateMany({
      where: { disputeId: dispute.id },
      data: { disputeId: null },
    });
    await tx.dispute.delete({ where: { id: dispute.id } });
  }

  await tx.orderItem.deleteMany({ where: { orderId } });
  await tx.order.delete({ where: { id: orderId } });
}

/**
 * Collects internal order UUIDs where the user is buyer, lister, curator, or disputant.
 */
export async function collectOrderIdsForUser(
  tx: PrismaTx,
  userId: string,
): Promise<string[]> {
  const ids = new Set<string>();

  const [
    buyerOrders,
    listerOrders,
    shipmentOrders,
    curatorOrderItems,
    rentalOrders,
    disputeOrders,
  ] = await Promise.all([
    tx.order.findMany({ where: { userId }, select: { id: true } }),
    tx.orderLister.findMany({
      where: { listerId: userId },
      select: { orderId: true },
    }),
    tx.shipment.findMany({
      where: { listerId: userId },
      select: { orderId: true },
    }),
    tx.orderItem.findMany({
      where: { product: { curatorId: userId } },
      select: { orderId: true },
    }),
    tx.rental.findMany({
      where: { OR: [{ userId }, { curatorId: userId }] },
      select: { orderId: true },
    }),
    tx.dispute.findMany({
      where: { userId },
      select: { orderId: true },
    }),
  ]);

  for (const row of buyerOrders) ids.add(row.id);
  for (const row of listerOrders) ids.add(row.orderId);
  for (const row of shipmentOrders) ids.add(row.orderId);
  for (const row of curatorOrderItems) ids.add(row.orderId);
  for (const row of rentalOrders) ids.add(row.orderId);
  for (const row of disputeOrders) ids.add(row.orderId);

  return [...ids];
}

/**
 * Hard-deletes a product and non-historical dependents.
 * Orders that only contain this product are removed; multi-item orders block deletion.
 */
export async function deleteProductCascade(
  tx: PrismaTx,
  productId: string,
): Promise<void> {
  const orderItems = await tx.orderItem.findMany({
    where: { productId },
    select: { orderId: true },
  });
  const orderIds = [...new Set(orderItems.map((i) => i.orderId))];

  for (const orderId of orderIds) {
    const totalItems = await tx.orderItem.count({ where: { orderId } });
    const productItems = orderItems.filter((i) => i.orderId === orderId).length;
    if (totalItems > productItems) {
      throw new BadRequestException(
        'Cannot delete this product because it is part of an order with other items. Remove it from active orders first or contact support.',
      );
    }
    await deleteOrderCascade(tx, orderId);
  }

  await tx.availabilityRequest.deleteMany({ where: { productId } });
  await tx.cartItem.deleteMany({ where: { productId } });
  await tx.favourite.deleteMany({ where: { productId } });
  await tx.review.deleteMany({ where: { productId } });
  await tx.rental.deleteMany({ where: { productId } });

  const attachment = await tx.attachments.findFirst({
    where: { productId },
  });
  if (attachment) {
    await tx.upload.updateMany({
      where: { attachmentId: attachment.id },
      data: { attachmentId: null },
    });
    await tx.attachments.delete({ where: { id: attachment.id } });
  }

  await tx.product.delete({ where: { id: productId } });
}

/**
 * Removes profile child rows before deleting the profile record.
 */
export async function deleteProfileCascade(
  tx: PrismaTx,
  profileId: string,
): Promise<void> {
  await tx.shipbubbleAddressVerification.deleteMany({ where: { profileId } });
  await tx.emergencyContact.deleteMany({ where: { profileId } });
  await tx.businessInfo.deleteMany({ where: { profileId } });
  await tx.address.deleteMany({ where: { profileId } });
  await tx.profile.update({
    where: { id: profileId },
    data: {
      avatarUploadId: null,
      ninUploadId: null,
      idDocumentUploadId: null,
    },
  });
  await tx.profile.delete({ where: { id: profileId } });
}
