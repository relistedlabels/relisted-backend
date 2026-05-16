import { OrderStatus, Prisma, Role } from '@prisma/client';
import { ADMIN_ORDER_ANALYTICS_CUTOFF } from 'src/constants/admin-analytics';

/** Internal staging curator (same default as public product queries). */
export function getStagingInternalCuratorId(): string {
  return (
    process.env.STAGING_INTERNAL_CURATOR_ID ??
    '7d172d18-daad-46cd-ab6d-8d8af28c0b16'
  );
}

/**
 * Real marketplace users for wallet balance totals.
 * Excludes admins, staging curator, and obvious test inboxes.
 */
export function buildWalletStatsUserWhere(): Prisma.UserWhereInput {
  return {
    role: { in: [Role.RENTER, Role.LISTER] },
    id: { not: getStagingInternalCuratorId() },
    NOT: {
      OR: [
        { email: { contains: 'mailtrap', mode: 'insensitive' } },
        { email: { endsWith: '@example.com', mode: 'insensitive' } },
        { email: { startsWith: 'test@', mode: 'insensitive' } },
        { email: { contains: '@test.', mode: 'insensitive' } },
      ],
    },
  };
}

/** Orders counted in wallet fee/VAT/escrow stats (since launch cutoff, non-test renter). */
export function buildWalletStatsOrderWhere(): Prisma.OrderWhereInput {
  return {
    status: {
      notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED],
    },
    createdAt: { gte: ADMIN_ORDER_ANALYTICS_CUTOFF },
    user: buildWalletStatsUserWhere(),
  };
}
