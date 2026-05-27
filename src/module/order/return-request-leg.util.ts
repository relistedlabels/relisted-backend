type ReturnRequestRow = {
  id: string;
  shipmentId: string | null;
  status?: string;
};

type ShipmentRow = {
  id: string;
  type: string;
  listerId?: string | null;
};

type OrderItemRow = {
  returnShipmentId?: string | null;
  imageUrl?: string | null;
  product?: {
    name?: string | null;
    attachments?: { uploads?: { url?: string | null }[] | null } | null;
    curator?: { id?: string; email?: string | null; name?: string | null } | null;
  } | null;
};

function orderItemsForReturnLeg(
  orderItems: OrderItemRow[] | null | undefined,
  returnShipmentId: string,
  listerId?: string | null,
): OrderItemRow[] {
  const items = orderItems ?? [];
  let linked = items.filter((oi) => oi.returnShipmentId === returnShipmentId);
  if (linked.length === 0 && listerId) {
    linked = items.filter((oi) => oi.product?.curator?.id === listerId);
  }
  return linked;
}

export function returnLegItemPreviews(
  orderItems: OrderItemRow[] | null | undefined,
  returnShipmentId: string,
  listerId?: string | null,
): Array<{ name: string; imageUrl: string | null }> {
  return orderItemsForReturnLeg(orderItems, returnShipmentId, listerId).map(
    (oi) => ({
      name: oi.product?.name?.trim() || 'Item',
      imageUrl:
        oi.imageUrl?.trim() ||
        oi.product?.attachments?.uploads?.[0]?.url?.trim() ||
        null,
    }),
  );
}

/** Match a return request to the lister's RETURN leg (multi-lister safe). */
export function findReturnRequestForLister<T extends ReturnRequestRow>(
  returnRequests: T[] | null | undefined,
  shipments: ShipmentRow[] | null | undefined,
  listerId: string,
): T | null {
  if (!returnRequests?.length) return null;
  const returnLegs = (shipments ?? []).filter((s) => s.type === 'RETURN');
  for (const rr of returnRequests) {
    if (!rr.shipmentId) continue;
    const leg = returnLegs.find((s) => s.id === rr.shipmentId);
    if (leg?.listerId === listerId) return rr;
  }
  if (returnRequests.length === 1 && returnLegs.length <= 1) {
    const onlyLeg = returnLegs[0];
    if (!onlyLeg?.listerId || onlyLeg.listerId === listerId) {
      return returnRequests[0];
    }
  }
  return null;
}

export function returnRequestExistsForShipment(
  returnRequests: Array<{ shipmentId: string | null }> | null | undefined,
  shipmentId: string | null | undefined,
): boolean {
  if (!shipmentId || !returnRequests?.length) return false;
  if (returnRequests.some((rr) => rr.shipmentId === shipmentId)) return true;
  return returnRequests.length === 1 && !returnRequests[0].shipmentId;
}

export function productNamesForReturnLeg(
  orderItems: OrderItemRow[] | null | undefined,
  returnShipmentId: string,
  listerId?: string | null,
  fallback = 'your rental item',
): string {
  const items = orderItems ?? [];
  let linked = items.filter((oi) => oi.returnShipmentId === returnShipmentId);
  if (linked.length === 0 && listerId) {
    linked = items.filter((oi) => oi.product?.curator?.id === listerId);
  }
  const names = linked
    .map((oi) => oi.product?.name?.trim())
    .filter((n): n is string => Boolean(n));
  return names.length ? names.join(', ') : fallback;
}

export function resolveCuratorForReturnLeg(
  orderItems: OrderItemRow[] | null | undefined,
  listerId: string | null | undefined,
) {
  if (!listerId) return null;
  for (const oi of orderItems ?? []) {
    const c = oi.product?.curator;
    if (c?.id === listerId) return c;
  }
  return null;
}

export function listerDisplayName(
  lister: {
    name?: string | null;
    profile?: { businessInfo?: { businessName?: string | null } | null } | null;
  } | null,
): string {
  return (
    lister?.profile?.businessInfo?.businessName?.trim() ||
    lister?.name?.trim() ||
    'there'
  );
}
