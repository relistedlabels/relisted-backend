/**
 * @deprecated Use resend-renter-order-confirmation.mjs on prod (ts-node OOMs on 512MB).
 *
 *   node resend-renter-order-confirmation.mjs ORD-xxx [--dry-run]
 *
 * Or call POST /api/admin/orders/:orderId/resend-renter-confirmation (admin JWT).
 */
console.error(
  'Use: node resend-renter-order-confirmation.mjs <orderId> [--dry-run]',
);
process.exit(1);
