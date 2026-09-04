import {
  buildListerEarningsWalletWhere,
  groupListerEarningsByMonth,
  LISTER_EARNINGS_WALLET_NOTE_FRAGMENTS,
} from './lister-earnings.util';

describe('lister-earnings.util', () => {
  it('matches all known lister payout note fragments', () => {
    expect(LISTER_EARNINGS_WALLET_NOTE_FRAGMENTS).toEqual(
      expect.arrayContaining([
        'Escrow payout released after dispute resolution',
        'Collateral received after dispute resolution',
        'Final payout released for completed order',
      ]),
    );
  });

  it('buildListerEarningsWalletWhere filters by lister, success credits, and note patterns', () => {
    const start = new Date('2026-06-01');
    const end = new Date('2026-06-30T23:59:59');
    const where = buildListerEarningsWalletWhere('lister-1', { start, end });

    expect(where.status).toBe('SUCCESS');
    expect(where.amount).toEqual({ gt: 0 });
    expect(where.wallet).toEqual({ userId: 'lister-1' });
    expect(where.createdAt).toEqual({ gte: start, lte: end });
    expect(where.OR).toHaveLength(
      LISTER_EARNINGS_WALLET_NOTE_FRAGMENTS.length,
    );
  });

  it('groupListerEarningsByMonth sums revenue and distinct orders', () => {
    const rows = [
      {
        amount: 34000,
        createdAt: new Date('2026-06-19T22:08:25Z'),
        orderId: 'order-1',
      },
      {
        amount: 5000,
        createdAt: new Date('2026-06-19T22:08:26Z'),
        orderId: 'order-1',
      },
      {
        amount: 10000,
        createdAt: new Date('2026-05-02T10:00:00Z'),
        orderId: 'order-2',
      },
    ];

    const grouped = groupListerEarningsByMonth(rows, 2026);
    expect(grouped[5].month).toBe('June');
    expect(grouped[5].revenue).toBe(39000);
    expect(grouped[5].orders).toBe(1);
    expect(grouped[4].month).toBe('May');
    expect(grouped[4].revenue).toBe(10000);
    expect(grouped[4].orders).toBe(1);
    expect(grouped[7].revenue).toBe(0);
  });
});
