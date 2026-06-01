import type { ListingType } from '@prisma/client';

type ListerLine = {
  days: number;
  product?: { listingType?: string | null } | null;
};

/** Prisma filter: order lines belonging to this lister (product owner or shipment leg). */
export function orderItemsForListerWhere(listerId: string) {
  return {
    OR: [
      { product: { curatorId: listerId } },
      { outboundShipment: { listerId } },
      { returnShipment: { listerId } },
      { resaleShipment: { listerId } },
    ],
  };
}

export function orderItemsForListerInclude(listerId: string) {
  return { where: orderItemsForListerWhere(listerId) };
}

export function shipmentsForListerWhere(listerId: string) {
  return { listerId };
}

export function isResalePurchaseLine(item: ListerLine): boolean {
  const lt = item.product?.listingType;
  return (
    lt === 'RESALE' || (lt === 'RENT_OR_RESALE' && (item.days ?? 0) === 0)
  );
}

export function isRentalLine(item: ListerLine): boolean {
  return (
    (item.days ?? 0) > 0 &&
    (item.product?.listingType === 'RENTAL' ||
      item.product?.listingType === 'RENT_OR_RESALE')
  );
}

/** Listing type for one lister's slice of a multi-lister order. */
export function listerOrderListingTypeFromItems(
  items: ListerLine[],
): ListingType {
  const hasResale = items.some(isResalePurchaseLine);
  const hasRental = items.some(isRentalLine);
  if (hasResale && hasRental) return 'RENT_OR_RESALE';
  if (hasResale) return 'RESALE';
  return 'RENTAL';
}
