/** Earliest order/rental `createdAt` included in admin order-linked analytics. */
export const ADMIN_ORDER_ANALYTICS_CUTOFF = new Date(
  process.env.ADMIN_ORDER_ANALYTICS_CUTOFF ??
    process.env.ADMIN_ANALYTICS_CUTOFF ??
    '2026-04-01T00:00:00.000Z',
);
