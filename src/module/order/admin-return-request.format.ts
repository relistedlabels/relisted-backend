type ReturnRequestRow = {
  id: string;
  itemCondition: string;
  damageNotes?: string | null;
  imageUrls: string[];
  listerCondition?: string | null;
  listerDamageNotes?: string | null;
  listerConfirmationImages: string[];
  status: string;
  trackingNumber?: string | null;
  pickupAddress?: string | null;
  pickupWindowStart?: Date | string | null;
  pickupWindowEnd?: Date | string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
  shippedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
};

const toIso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};

export const adminReturnRequestStatusLabel = (status: string): string => {
  const key = status.trim().toUpperCase();
  const labels: Record<string, string> = {
    PENDING_PICKUP: 'Pending pickup',
    IN_TRANSIT: 'In transit',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return labels[key] ?? status.replace(/_/g, ' ');
};

export const formatAdminReturnRequest = (
  rr: ReturnRequestRow | null | undefined,
) => {
  if (!rr) return null;

  return {
    id: rr.id,
    status: rr.status,
    statusLabel: adminReturnRequestStatusLabel(rr.status),
    itemCondition: rr.itemCondition,
    damageNotes: rr.damageNotes ?? null,
    imageUrls: rr.imageUrls ?? [],
    listerCondition: rr.listerCondition ?? null,
    listerDamageNotes: rr.listerDamageNotes ?? null,
    listerConfirmationImages: rr.listerConfirmationImages ?? [],
    trackingNumber: rr.trackingNumber ?? null,
    pickupAddress: rr.pickupAddress ?? null,
    pickupWindowStart: toIso(rr.pickupWindowStart),
    pickupWindowEnd: toIso(rr.pickupWindowEnd),
    createdAt: toIso(rr.createdAt)!,
    updatedAt: toIso(rr.updatedAt) ?? toIso(rr.createdAt)!,
    shippedAt: toIso(rr.shippedAt),
    deliveredAt: toIso(rr.deliveredAt),
  };
};
