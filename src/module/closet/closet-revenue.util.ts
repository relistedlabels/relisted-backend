import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type ClosetRevenueSplitKind =
  | 'RENTAL_CLEANING'
  | 'RESALE'
  | 'COMBINED';

type OrderItemRow = {
  days: number;
  rentalFee: number | null;
  cleaningFee: number | null;
  closetId: string | null;
  resaleListerAmount: number | null;
  product: {
    curatorId: string;
    listingType: string;
    resalePrice: number | null;
  };
};

function isRentalLine(oi: OrderItemRow): boolean {
  const lt = oi.product.listingType;
  return (
    oi.days > 0 && (lt === 'RENTAL' || lt === 'RENT_OR_RESALE')
  );
}

function isResaleLine(oi: OrderItemRow): boolean {
  const lt = oi.product.listingType;
  return lt === 'RESALE' || (lt === 'RENT_OR_RESALE' && oi.days === 0);
}

function lineWeightForSplit(oi: OrderItemRow, split: ClosetRevenueSplitKind): number {
  let w = 0;
  if (split === 'RENTAL_CLEANING') {
    if (isRentalLine(oi)) {
      w = (oi.rentalFee ?? 0) + (oi.cleaningFee ?? 0);
    }
  } else if (split === 'RESALE') {
    if (isResaleLine(oi)) {
      w = oi.resaleListerAmount ?? oi.product.resalePrice ?? 0;
    }
  } else {
    if (isRentalLine(oi)) {
      w += (oi.rentalFee ?? 0) + (oi.cleaningFee ?? 0);
    }
    if (isResaleLine(oi)) {
      w += oi.resaleListerAmount ?? oi.product.resalePrice ?? 0;
    }
  }
  return Math.max(0, w);
}

function aggregateClosetWeights(
  items: OrderItemRow[],
  listerId: string,
  split: ClosetRevenueSplitKind,
): Map<string, number> {
  const byCloset = new Map<string, number>();
  for (const oi of items) {
    if (oi.product.curatorId !== listerId || !oi.closetId) continue;
    const w = lineWeightForSplit(oi, split);
    if (w <= 0) continue;
    const id = oi.closetId;
    byCloset.set(id, (byCloset.get(id) ?? 0) + w);
  }
  return byCloset;
}

/**
 * Distribute `total` integer minor units across buckets proportional to weights (exact sum).
 */
function allocateProportionalInt(
  total: number,
  weights: Map<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  if (total <= 0 || weights.size === 0) return result;

  let W = 0;
  for (const w of weights.values()) W += Math.max(0, w);
  if (W <= 0) return result;

  const ids = [...weights.keys()];
  type Row = { id: string; floor: number; frac: number };
  const rows: Row[] = [];
  let sumFloor = 0;
  for (const id of ids) {
    const w = Math.max(0, weights.get(id)!);
    const raw = (total * w) / W;
    const floor = Math.floor(raw);
    rows.push({ id, floor, frac: raw - floor });
    sumFloor += floor;
  }
  let remainder = total - sumFloor;
  rows.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder && i < rows.length; i++) {
    rows[i].floor += 1;
  }
  for (const r of rows) {
    if (r.floor > 0) result.set(r.id, r.floor);
  }
  return result;
}

/**
 * Increments `Closet.closetWalletBalance` for this lister's share of an order payout.
 * Only lines with a non-null `closetId` snapshot participate; amounts with no closet attribution are skipped.
 */
export async function incrementClosetRevenueForListerPayout(
  tx: Tx,
  params: {
    orderId: string;
    listerId: string;
    amount: number;
    split: ClosetRevenueSplitKind;
  },
): Promise<void> {
  const { orderId, listerId, amount, split } = params;
  if (!amount || amount <= 0) return;

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      days: true,
      rentalFee: true,
      cleaningFee: true,
      closetId: true,
      resaleListerAmount: true,
      product: {
        select: { curatorId: true, listingType: true, resalePrice: true },
      },
    },
  });

  const weights = aggregateClosetWeights(items as OrderItemRow[], listerId, split);
  const shares = allocateProportionalInt(amount, weights);
  for (const [closetId, inc] of shares) {
    if (inc <= 0) continue;
    await tx.closet.update({
      where: { id: closetId },
      data: { closetWalletBalance: { increment: inc } },
    });
  }
}

/**
 * Closet-facing amount to record when confirming a return, avoiding double-counting
 * rental that was already attributed at outbound delivery (PARTIALLY_RELEASED).
 */
export function closetCreditForReturnReceiptEscrow(escrow: {
  status: string;
  resaleAmount: number | null;
  rentalAmount: number;
  cleaningFee: number;
}): number {
  if (escrow.status === 'PARTIALLY_RELEASED') {
    return escrow.resaleAmount ?? 0;
  }
  return (
    (escrow.rentalAmount ?? 0) +
    (escrow.cleaningFee ?? 0) +
    (escrow.resaleAmount ?? 0)
  );
}

export function closetSplitKindForResaleOrderConfirm(
  escrow: { status: string },
  orderItems: { days: number; product: { listingType: string } }[],
): ClosetRevenueSplitKind {
  if (escrow.status === 'PARTIALLY_RELEASED') {
    return 'RESALE';
  }
  const hasRental = orderItems.some(
    (i) =>
      i.days > 0 &&
      (i.product.listingType === 'RENTAL' ||
        i.product.listingType === 'RENT_OR_RESALE'),
  );
  const hasResale = orderItems.some(
    (i) =>
      i.product.listingType === 'RESALE' ||
      (i.product.listingType === 'RENT_OR_RESALE' && i.days === 0),
  );
  if (hasRental && hasResale) return 'COMBINED';
  if (hasResale) return 'RESALE';
  return 'RENTAL_CLEANING';
}
