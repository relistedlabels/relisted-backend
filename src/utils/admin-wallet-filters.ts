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

/** Internal/test accounts whose wallet ledger should not count as production. */
export function buildTestOrInternalUserWhere(): Prisma.UserWhereInput {
  return {
    OR: [
      { role: Role.ADMIN },
      { id: getStagingInternalCuratorId() },
      { email: { contains: 'mailtrap', mode: 'insensitive' } },
      { email: { endsWith: '@example.com', mode: 'insensitive' } },
      { email: { startsWith: 'test@', mode: 'insensitive' } },
      { email: { contains: '@test.', mode: 'insensitive' } },
    ],
  };
}

/** Rows to remove in wallet cleanup (pre-launch, non-success, or test/internal users). */
export function buildWalletTransactionCleanupWhere(
  cutoff: Date = ADMIN_ORDER_ANALYTICS_CUTOFF,
): Prisma.WalletTransactionWhereInput {
  return {
    OR: [
      { createdAt: { lt: cutoff } },
      { status: { not: 'SUCCESS' } },
      { wallet: { user: buildTestOrInternalUserWhere() } },
    ],
  };
}

/** Production ledger rows kept after cleanup. */
export function buildProductionWalletTransactionWhere(
  cutoff: Date = ADMIN_ORDER_ANALYTICS_CUTOFF,
): Prisma.WalletTransactionWhereInput {
  return {
    status: 'SUCCESS',
    createdAt: { gte: cutoff },
    wallet: { user: buildWalletStatsUserWhere() },
  };
}
