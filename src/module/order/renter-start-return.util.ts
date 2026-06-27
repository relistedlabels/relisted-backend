type ShipmentLeg = {
  id: string;
  type: string;
  status: string;
  listerId?: string | null;
};

type ReturnRequestRow = {
  shipmentId: string | null;
  status?: string;
};

type OrderItemRow = {
  days?: number;
  product?: { listingType?: string | null } | null;
};

const TERMINAL_ORDER_STATUSES = new Set([
  'COMPLETED',
  'RETURNED',
  'CANCELLED',
  'REJECTED',
]);

export function orderHasRentalLinesForReturn(
  orderItems: OrderItemRow[] | null | undefined,
): boolean {
  return (orderItems ?? []).some((item) => {
    const days = item.days ?? 0;
    const lt = item.product?.listingType;
    return days > 0 && (lt === 'RENTAL' || lt === 'RENT_OR_RESALE');
  });
}

function outboundDeliveredForReturnLeg(
  outboundLegs: ShipmentLeg[],
  returnLeg: ShipmentLeg,
): boolean {
  const delivered = outboundLegs.filter((leg) => leg.status === 'COMPLETED');
  if (delivered.length === 0) return false;
  if (returnLeg.listerId) {
    return delivered.some(
      (leg) => !leg.listerId || leg.listerId === returnLeg.listerId,
    );
  }
  return true;
}

function hasActiveReturnForLeg(
  returnRequests: ReturnRequestRow[],
  shipmentId: string,
  returnLegCount: number,
): boolean {
  const active = returnRequests.filter(
    (rr) => String(rr.status ?? '').toUpperCase() !== 'REJECTED',
  );
  if (active.some((rr) => rr.shipmentId === shipmentId)) return true;
  if (active.length === 1 && !active[0].shipmentId && returnLegCount === 1) {
    return true;
  }
  return false;
}

/**
 * Renter may start a return when an OUTBOUND leg is delivered (COMPLETED) and
 * the matching RETURN leg has no active return request yet.
 */
export function resolveRenterStartReturn(input: {
  listingType?: string | null;
  status: string;
  orderItems: OrderItemRow[];
  shipments: ShipmentLeg[];
  returnRequests: ReturnRequestRow[];
}): { showStartReturn: boolean; returnShipmentId: string | null } {
  const statusKey = String(input.status ?? '').toUpperCase();
  if (TERMINAL_ORDER_STATUSES.has(statusKey)) {
    return { showStartReturn: false, returnShipmentId: null };
  }

  if (!orderHasRentalLinesForReturn(input.orderItems)) {
    return { showStartReturn: false, returnShipmentId: null };
  }

  const outboundLegs = input.shipments.filter((leg) => leg.type === 'OUTBOUND');
  const returnLegs = input.shipments.filter((leg) => leg.type === 'RETURN');

  for (const returnLeg of returnLegs) {
    if (!outboundDeliveredForReturnLeg(outboundLegs, returnLeg)) continue;
    if (
      hasActiveReturnForLeg(
        input.returnRequests,
        returnLeg.id,
        returnLegs.length,
      )
    ) {
      continue;
    }
    return { showStartReturn: true, returnShipmentId: returnLeg.id };
  }

  return { showStartReturn: false, returnShipmentId: null };
}
