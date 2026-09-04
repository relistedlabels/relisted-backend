import {
  formatDispatchWindowCompact,
  formatRentalPeriodCompact,
} from '../shipment/dispatch-window-format';
import { firstProductAttachmentImageUrlFromUploads } from '../../utils/product-attachment-upload-order';

export type RenterCheckoutEmailLine = {
  productName: string;
  imageUrl?: string | null;
  lineType: 'rental' | 'purchase';
  days?: number;
  rentalPeriodText?: string | null;
  rentalDeliveryWindowText?: string | null;
  returnPickupWindowText?: string | null;
  purchaseDeliveryWindowText?: string | null;
};

function windowText(
  start?: Date | string | null,
  end?: Date | string | null,
): string | null {
  if (!start || !end) return null;
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return formatDispatchWindowCompact(s, e);
}

function rentalPeriodText(
  start?: Date | string | null,
  end?: Date | string | null,
): string | null {
  if (!start || !end) return null;
  const text = formatRentalPeriodCompact(start, end);
  return text || null;
}

function isRentalCartLine(item: {
  days?: number;
  product?: { listingType?: string | null };
}): boolean {
  return (
    (item.days ?? 0) > 0 &&
    (item.product?.listingType === 'RENTAL' ||
      item.product?.listingType === 'RENT_OR_RESALE')
  );
}

function isPurchaseCartLine(item: {
  days?: number;
  product?: { listingType?: string | null };
}): boolean {
  return (
    item.product?.listingType === 'RESALE' ||
    (item.product?.listingType === 'RENT_OR_RESALE' && (item.days ?? 0) === 0)
  );
}

function findListerBucketForCartItem(
  listerOrdersData: Array<{ items?: Array<{ id?: string }> }>,
  cartItemId: string,
) {
  return listerOrdersData.find((ld) =>
    ld.items?.some((row) => row.id === cartItemId),
  );
}

/** Build renter confirmation lines at checkout (cart + dispatch windows in memory). */
export function buildRenterCheckoutEmailLinesFromCheckout(
  eligibleItems: Array<{
    id: string;
    days?: number;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    product?: {
      name?: string | null;
      listingType?: string | null;
      attachments?: {
        uploads?: Array<{
          url?: string | null;
          displayOrder?: number | null;
          id?: string;
        }>;
      } | null;
    };
  }>,
  listerOrdersData: Array<{
    bucketMode?: string;
    outboundWindow?: { start: Date; end: Date } | null;
    returnWindow?: { start: Date; end: Date } | null;
    resaleWindow?: { start: Date; end: Date } | null;
    items?: Array<{ id?: string }>;
  }>,
): RenterCheckoutEmailLine[] {
  const lines: RenterCheckoutEmailLine[] = [];

  for (const item of eligibleItems) {
    const productName = item.product?.name || 'Item';
    const imageUrl = firstProductAttachmentImageUrlFromUploads(
      item.product?.attachments?.uploads,
    );
    const bucket = findListerBucketForCartItem(listerOrdersData, item.id);

    if (isRentalCartLine(item)) {
      lines.push({
        productName,
        imageUrl,
        lineType: 'rental',
        days: item.days,
        rentalPeriodText: rentalPeriodText(item.startDate, item.endDate),
        rentalDeliveryWindowText: windowText(
          bucket?.outboundWindow?.start,
          bucket?.outboundWindow?.end,
        ),
        returnPickupWindowText: windowText(
          bucket?.returnWindow?.start,
          bucket?.returnWindow?.end,
        ),
      });
      continue;
    }

    if (isPurchaseCartLine(item)) {
      lines.push({
        productName,
        imageUrl,
        lineType: 'purchase',
        purchaseDeliveryWindowText: windowText(
          bucket?.resaleWindow?.start,
          bucket?.resaleWindow?.end,
        ),
      });
    }
  }

  return lines;
}

type LoadedOrderItem = {
  days: number;
  imageUrl?: string | null;
  productId?: string;
  product?: { name?: string | null; listingType?: string | null } | null;
  outboundShipment?: {
    scheduledWindowStart?: Date | null;
    scheduledWindowEnd?: Date | null;
  } | null;
  returnShipment?: {
    scheduledWindowStart?: Date | null;
    scheduledWindowEnd?: Date | null;
  } | null;
  resaleShipment?: {
    scheduledWindowStart?: Date | null;
    scheduledWindowEnd?: Date | null;
  } | null;
};

/** Build renter confirmation lines from a persisted order (resend / admin). */
export function buildRenterCheckoutEmailLinesFromOrder(
  orderItems: LoadedOrderItem[],
  rentals: Array<{
    productId: string;
    startDate: Date;
    endDate: Date;
    days: number;
  }>,
): RenterCheckoutEmailLine[] {
  const rentalByProduct = new Map(
    rentals.map((r) => [r.productId, r] as const),
  );
  const lines: RenterCheckoutEmailLine[] = [];

  for (const oi of orderItems) {
    const productName = oi.product?.name || 'Item';
    const listingType = oi.product?.listingType;
    const rental = oi.productId
      ? rentalByProduct.get(oi.productId)
      : undefined;

    const isRental =
      oi.days > 0 &&
      (listingType === 'RENTAL' || listingType === 'RENT_OR_RESALE');
    const isPurchase =
      listingType === 'RESALE' ||
      (listingType === 'RENT_OR_RESALE' && oi.days === 0);

    if (isRental) {
      lines.push({
        productName,
        imageUrl: oi.imageUrl ?? null,
        lineType: 'rental',
        days: rental?.days ?? oi.days,
        rentalPeriodText: rental
          ? rentalPeriodText(rental.startDate, rental.endDate)
          : null,
        rentalDeliveryWindowText: windowText(
          oi.outboundShipment?.scheduledWindowStart,
          oi.outboundShipment?.scheduledWindowEnd,
        ),
        returnPickupWindowText: windowText(
          oi.returnShipment?.scheduledWindowStart,
          oi.returnShipment?.scheduledWindowEnd,
        ),
      });
      continue;
    }

    if (isPurchase) {
      lines.push({
        productName,
        imageUrl: oi.imageUrl ?? null,
        lineType: 'purchase',
        purchaseDeliveryWindowText: windowText(
          oi.resaleShipment?.scheduledWindowStart,
          oi.resaleShipment?.scheduledWindowEnd,
        ),
      });
    }
  }

  return lines;
}
