import { Prisma } from '@prisma/client';
import { formatRentalBoundaryDateLagos } from '../shipment/dispatch-window-format';

const withdrawInclude = {
  product: { include: { curator: { select: { email: true, name: true } } } },
  requester: { select: { name: true } },
} satisfies Prisma.AvailabilityRequestInclude;

export type AvailabilityRowForWithdraw = Prisma.AvailabilityRequestGetPayload<{
  include: typeof withdrawInclude;
}>;

export type ListerWithdrawNotify = {
  listerId: string;
  productName: string;
  requestId: string;
  afterApproval: boolean;
  emailData: {
    email: string;
    listerName: string;
    renterName: string;
    productName: string;
    requestId: string;
    rentalDays: number;
    totalPrice: number;
    startDate: string;
    endDate: string;
    viewLink: string;
    withdrawn: boolean;
    afterApproval: boolean;
  };
};

export function buildListerWithdrawRentalRequestEmailContext(
  r: Pick<
    AvailabilityRowForWithdraw,
    | 'id'
    | 'rentalDays'
    | 'totalPrice'
    | 'startDate'
    | 'endDate'
    | 'product'
    | 'requester'
  >,
  afterApproval: boolean,
): ListerWithdrawNotify['emailData'] {
  const base = process.env.CLIENT_URL || '';
  return {
    email: r.product?.curator?.email ?? '',
    listerName: r.product?.curator?.name ?? 'Lister',
    renterName: r.requester?.name ?? 'A user',
    productName: r.product?.name ?? 'your item',
    requestId: r.id,
    rentalDays: r.rentalDays ?? 0,
    totalPrice: r.totalPrice ?? 0,
    startDate: r.startDate
      ? formatRentalBoundaryDateLagos(r.startDate)
      : 'N/A',
    endDate: r.endDate ? formatRentalBoundaryDateLagos(r.endDate) : 'N/A',
    viewLink: `${base}/listers/orders/${r.id}`,
    withdrawn: true,
    afterApproval,
  };
}

/**
 * When a renter removes a cart line, keep AvailabilityRequest in sync:
 * - PENDING: mark CANCELLED_BY_RENTER (lister can still open the request record)
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
    include: withdrawInclude,
  });

  const toNotify: ListerWithdrawNotify[] = [];

  for (const r of requests) {
    if (r.status === 'PENDING') {
      await tx.availabilityRequest.update({
        where: { id: r.id },
        data: { status: 'CANCELLED_BY_RENTER' },
      });
      const emailData = buildListerWithdrawRentalRequestEmailContext(r, false);
      toNotify.push({
        listerId: r.listerId,
        productName: emailData.productName,
        requestId: r.id,
        afterApproval: false,
        emailData,
      });
    } else if (r.status === 'ACCEPTED') {
      await tx.availabilityRequest.update({
        where: { id: r.id },
        data: { status: 'CANCELLED_BY_RENTER' },
      });
      const emailData = buildListerWithdrawRentalRequestEmailContext(r, true);
      toNotify.push({
        listerId: r.listerId,
        productName: emailData.productName,
        requestId: r.id,
        afterApproval: true,
        emailData,
      });
    }
  }

  return toNotify;
}
