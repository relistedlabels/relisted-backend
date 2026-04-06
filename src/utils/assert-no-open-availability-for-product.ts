import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';

/** Rejects a duplicate request while a live PENDING or cart-tied ACCEPTED exists for this product. */
export async function assertNoOpenAvailabilityRequestForProduct(
  prisma: PrismaService,
  requesterId: string,
  productId: string,
): Promise<void> {
  const pendingOpen = await prisma.availabilityRequest.findFirst({
    where: {
      requesterId,
      productId,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (pendingOpen) {
    bad('You already have a pending availability request for this product.');
  }

  const accepted = await prisma.availabilityRequest.findFirst({
    where: { requesterId, productId, status: 'ACCEPTED' },
    orderBy: { createdAt: 'desc' },
  });
  const cid = accepted?.cartItemId?.trim();
  if (cid) {
    const line = await prisma.cartItem.findUnique({
      where: { id: cid },
      include: { cart: true },
    });
    if (
      line?.productId === productId &&
      line.cart?.userId === requesterId
    ) {
      bad(
        'This product already has an approved request. Complete checkout or remove it from your cart before requesting again.',
      );
    }
  }
}
