import { EscrowStatus, Prisma } from '@prisma/client';
import type { PrismaService } from 'src/services/prisma/prisma.service';

/**
 * Wallet ledger notes that credit a lister's earnings (rental, cleaning, resale, dispute repair).
 * Keep in sync with payout paths in admin, order, and listers services.
 */
export const LISTER_EARNINGS_WALLET_NOTE_FRAGMENTS = [
  'Rental payment released for order',
  'Rental payment auto-released after',
  'Escrow release for order',
  'Final payout released for completed order',
  'Escrow payout released after dispute resolution',
  'Collateral received after dispute resolution',
  'Resale payment auto-released for order',
  'Resale payment released for order',
  'Payment auto-released after',
  'Payment released for resale order',
] as const;

export function buildListerEarningsWalletWhere(
  listerId: string,
  range?: { start: Date; end: Date },
): Prisma.WalletTransactionWhereInput {
  return {
    status: 'SUCCESS',
    amount: { gt: 0 },
    wallet: { userId: listerId },
    ...(range
      ? { createdAt: { gte: range.start, lte: range.end } }
      : {}),
    OR: LISTER_EARNINGS_WALLET_NOTE_FRAGMENTS.map((fragment) => ({
      note: { contains: fragment, mode: 'insensitive' as const },
    })),
  };
}

type PrismaLike = Pick<PrismaService, 'walletTransaction' | 'escrow'>;

export async function sumListerEarningsWalletCredits(
  prisma: PrismaLike,
  listerId: string,
  range?: { start: Date; end: Date },
): Promise<number> {
  const agg = await prisma.walletTransaction.aggregate({
    where: buildListerEarningsWalletWhere(listerId, range),
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/**
 * Remaining escrow held for a lister (rental + cleaning + collateral + resale still locked).
 */
export async function sumListerPendingEscrow(
  prisma: PrismaLike,
  listerId: string,
): Promise<number> {
  const rows = await prisma.escrow.findMany({
    where: {
      listerId,
      status: { in: [EscrowStatus.LOCKED, EscrowStatus.PARTIALLY_RELEASED] },
    },
    select: {
      status: true,
      rentalAmount: true,
      cleaningFee: true,
      collateralAmount: true,
      resaleAmount: true,
    },
  });

  let total = 0;
  for (const row of rows) {
    const rental = row.rentalAmount ?? 0;
    const cleaning = row.cleaningFee ?? 0;
    const collateral = row.collateralAmount ?? 0;
    const resale = row.resaleAmount ?? 0;
    if (row.status === EscrowStatus.LOCKED) {
      total += rental + cleaning + collateral + resale;
    } else {
      total += cleaning + collateral + resale;
    }
  }
  return total;
}

export type ListerEarningsLedgerRow = {
  amount: number;
  createdAt: Date;
  orderId: string | null;
};

export async function listListerEarningsWalletCredits(
  prisma: PrismaLike,
  listerId: string,
  range: { start: Date; end: Date },
): Promise<ListerEarningsLedgerRow[]> {
  return prisma.walletTransaction.findMany({
    where: buildListerEarningsWalletWhere(listerId, range),
    select: { amount: true, createdAt: true, orderId: true },
    orderBy: { createdAt: 'asc' },
  });
}

export function groupListerEarningsByMonth(
  rows: ListerEarningsLedgerRow[],
  year: number,
): { month: string; revenue: number; orders: number }[] {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return months.map((month, index) => {
    const monthRows = rows.filter((r) => {
      const d = r.createdAt;
      return d.getFullYear() === year && d.getMonth() === index;
    });
    const orderIds = new Set(
      monthRows.map((r) => r.orderId).filter((id): id is string => !!id),
    );
    return {
      month,
      revenue: monthRows.reduce((sum, r) => sum + r.amount, 0),
      orders: orderIds.size,
    };
  });
}
