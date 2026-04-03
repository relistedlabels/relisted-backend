import { Prisma } from '@prisma/client';

export type ListerWithdrawNotify = {
  listerId: string;
  productName: string;
  requestId: string;
};

/**
 * When a renter removes a cart line, keep AvailabilityRequest in sync:
 * - PENDING: delete (lister no longer sees an actionable request)
 * - ACCEPTED: mark CANCELLED_BY_RENTER (lister must not expect payment)
 */
export async function withdrawAvailabilityRequestsForCartItem(
  tx: Prisma.TransactionClient,
  cartItemId: string,
  requesterId: string,
): Promise<ListerWithdrawNotify[]> {
  if (!cartItemId) return [];

  const requests = await tx.availabilityRequest.findMany({
    where: { cartItemId, requesterId },
    include: { product: { select: { name: true } } },
  });

  const toNotify: ListerWithdrawNotify[] = [];

  for (const r of requests) {
    if (r.status === 'PENDING') {
      await tx.availabilityRequest.delete({ where: { id: r.id } });
    } else if (r.status === 'ACCEPTED') {
      await tx.availabilityRequest.update({
        where: { id: r.id },
        data: { status: 'CANCELLED_BY_RENTER' },
      });
      toNotify.push({
        listerId: r.listerId,
        productName: r.product?.name ?? 'your item',
        requestId: r.id,
      });
    }
  }

  return toNotify;
}
