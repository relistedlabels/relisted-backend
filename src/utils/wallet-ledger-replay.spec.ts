import { replayWalletBalancesFromLedger } from './wallet-ledger-replay';

describe('replayWalletBalancesFromLedger', () => {
  it('applies wema deposit then checkout with collateral', () => {
    const rows = [
      {
        amount: 100_000,
        status: 'SUCCESS',
        note: 'Wema Virtual Account Deposit',
      },
      {
        amount: -60_000,
        status: 'SUCCESS',
        note: 'Cart checkout payment for 1 items (Collateral locked: 10000)',
      },
    ];
    const b = replayWalletBalancesFromLedger(rows);
    expect(b.availableBalance).toBe(40_000);
    expect(b.mainBalance).toBe(50_000);
    expect(b.collateralBalance).toBe(10_000);
  });

  it('applies dispute collateral release and withhold without ghost main balance', () => {
    const rows = [
      {
        amount: 100_000,
        status: 'SUCCESS',
        note: 'Wema Virtual Account Deposit',
      },
      {
        amount: -50_000,
        status: 'SUCCESS',
        note: 'Cart checkout payment for 1 items (Collateral locked: 50000)',
      },
      {
        amount: 30_000,
        status: 'SUCCESS',
        note: 'Collateral released after dispute resolution for order ORD-1',
      },
      {
        amount: -20_000,
        status: 'SUCCESS',
        note: 'Collateral withheld after dispute resolution for order ORD-1',
      },
    ];
    const b = replayWalletBalancesFromLedger(rows);
    expect(b.collateralBalance).toBe(0);
    expect(b.availableBalance).toBe(80_000);
    expect(b.mainBalance).toBe(80_000);
  });
});
