import { ListingType, Prisma, ProductStatus } from '@prisma/client';

/** Sets resale products back to AVAILABLE after admin order cancellation. */
export async function markResaleProductsAvailableForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string[]> {
  const items = await tx.orderItem.findMany({
    where: { orderId, days: 0 },
    include: { product: { select: { listingType: true } } },
  });

  const productIds: string[] = [];
  for (const item of items) {
    const listingType = item.product?.listingType;
    const isResaleItem =
      listingType === ListingType.RESALE ||
      listingType === ListingType.RENT_OR_RESALE;
    if (!isResaleItem) continue;

    await tx.product.update({
      where: { id: item.productId },
      data: { status: ProductStatus.AVAILABLE },
    });
    productIds.push(item.productId);
  }
  return productIds;
}
