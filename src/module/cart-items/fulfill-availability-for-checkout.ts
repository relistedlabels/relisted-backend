import { OrderStatus, Prisma, PrismaClient } from '@prisma/client';

/** Order statuses where a renter still has the item or return is in progress. */
export const ACTIVE_RENTAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PROCESSING,
  OrderStatus.CONFIRMED,
  OrderStatus.ACCEPTED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.DELIVERED,
  OrderStatus.ACTIVE,
  OrderStatus.RETURN_DUE,
  OrderStatus.IN_DISPUTE,
  OrderStatus.RETURNED,
];

/**
 * After checkout, close the availability request tied to the cart line and drop
 * stale terminal rows for the same product so reminder jobs do not treat an
 * old expired request as a new missed rental.
 */
export async function fulfillAvailabilityRequestsForCheckout(
  tx: Prisma.TransactionClient,
  params: {
    requesterId: string;
    cartItemIds: string[];
    productIds: string[];
  },
): Promise<void> {
  const { requesterId, cartItemIds, productIds } = params;
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];

  if (cartItemIds.length > 0) {
    await tx.availabilityRequest.updateMany({
      where: {
        requesterId,
        cartItemId: { in: cartItemIds },
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      data: { status: 'ORDERED' },
    });
  }

  if (uniqueProductIds.length > 0) {
    await tx.availabilityRequest.updateMany({
      where: {
        requesterId,
        productId: { in: uniqueProductIds },
        status: 'ACCEPTED',
      },
      data: { status: 'ORDERED' },
    });
  }

  if (uniqueProductIds.length > 0) {
    const now = new Date();
    await tx.availabilityRequest.deleteMany({
      where: {
        requesterId,
        productId: { in: uniqueProductIds },
        OR: [
          { status: { in: ['EXPIRED', 'REJECTED', 'CANCELLED_BY_RENTER'] } },
          { status: 'PENDING', expiresAt: { lte: now } },
        ],
      },
    });
  }
}

type ActiveOrderLookupClient = {
  order: Pick<PrismaClient['order'], 'findMany'>;
};

function buildOrderProductRequesterPairSet(
  pairs: Array<{ productId: string; requesterId: string }>,
): Map<string, { productId: string; requesterId: string }> {
  const uniquePairs = new Map<string, { productId: string; requesterId: string }>();
  for (const pair of pairs) {
    if (!pair.productId || !pair.requesterId) continue;
    uniquePairs.set(`${pair.productId}:${pair.requesterId}`, pair);
  }
  return uniquePairs;
}

async function findOrderProductRequesterPairs(
  prisma: ActiveOrderLookupClient,
  pairs: Array<{ productId: string; requesterId: string }>,
  statuses: OrderStatus[] | { notIn: OrderStatus[] },
): Promise<Set<string>> {
  const uniquePairs = buildOrderProductRequesterPairSet(pairs);
  if (uniquePairs.size === 0) return new Set();

  const productIds = [...new Set([...uniquePairs.values()].map((p) => p.productId))];
  const requesterIds = [
    ...new Set([...uniquePairs.values()].map((p) => p.requesterId)),
  ];

  const orders = await prisma.order.findMany({
    where: {
      userId: { in: requesterIds },
      status: Array.isArray(statuses) ? { in: statuses } : statuses,
      orderItems: { some: { productId: { in: productIds } } },
    },
    select: {
      userId: true,
      orderItems: { select: { productId: true } },
    },
  });

  const matched = new Set<string>();
  for (const order of orders) {
    for (const item of order.orderItems) {
      const key = `${item.productId}:${order.userId}`;
      if (uniquePairs.has(key)) matched.add(key);
    }
  }
  return matched;
}

/** In-flight rental or resale order (item still with renter or return pending). */
export async function findActiveOrderProductRequesterPairs(
  prisma: ActiveOrderLookupClient,
  pairs: Array<{ productId: string; requesterId: string }>,
): Promise<Set<string>> {
  return findOrderProductRequesterPairs(prisma, pairs, ACTIVE_RENTAL_ORDER_STATUSES);
}

/** Any paid order for the product (includes completed); used to stop checkout reminders. */
export async function findSupersedingOrderProductRequesterPairs(
  prisma: ActiveOrderLookupClient,
  pairs: Array<{ productId: string; requesterId: string }>,
): Promise<Set<string>> {
  return findOrderProductRequesterPairs(prisma, pairs, {
    notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED],
  });
}

export async function markSupersededAvailabilityRequestsOrdered(
  tx: Pick<Prisma.TransactionClient, 'availabilityRequest'>,
  pairs: Array<{ id: string; productId: string; requesterId: string }>,
  supersededKeys: Set<string>,
): Promise<number> {
  const ids = pairs
    .filter((row) =>
      isAvailabilityRequestSupersededByActiveOrder(supersededKeys, row),
    )
    .map((row) => row.id);
  if (ids.length === 0) return 0;
  const result = await tx.availabilityRequest.updateMany({
    where: { id: { in: ids }, status: 'ACCEPTED' },
    data: { status: 'ORDERED' },
  });
  return result.count;
}

export function isAvailabilityRequestSupersededByActiveOrder(
  activePairs: Set<string>,
  request: { productId: string; requesterId: string },
): boolean {
  return activePairs.has(`${request.productId}:${request.requesterId}`);
}
