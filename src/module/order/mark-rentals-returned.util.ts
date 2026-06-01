import { ListingType, Prisma, ProductStatus } from '@prisma/client';

/** Marks all open rentals on an order as returned (frees product availability checks). */
export async function markRentalsReturnedForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  returnedAt: Date = new Date(),
  curatorId?: string,
): Promise<number> {
  const result = await tx.rental.updateMany({
    where: {
      orderId,
      isReturned: false,
      ...(curatorId ? { curatorId } : {}),
    },
    data: { isReturned: true, returnedAt },
  });
  return result.count;
}

/** Sets rental products back to AVAILABLE after return or dispute resolution. */
export async function markRentalProductsAvailableForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId, days: { gt: 0 } },
    include: { product: { select: { listingType: true } } },
  });

  for (const item of items) {
    const listingType = item.product?.listingType;
    const isRentalItem =
      listingType === ListingType.RENTAL ||
      listingType === ListingType.RENT_OR_RESALE;
    if (!isRentalItem) continue;

    await tx.product.update({
      where: { id: item.productId },
      data: { status: ProductStatus.AVAILABLE },
    });
  }
}

export function orderHasCompletedReturnRequest(order: {
  returnRequests?: { status: string }[] | null;
  returnRequest?: { status: string } | null;
}): boolean {
  if (order.returnRequest?.status === 'COMPLETED') return true;
  return (
    order.returnRequests?.some((rr) => rr.status === 'COMPLETED') ?? false
  );
}
