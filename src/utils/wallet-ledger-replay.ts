/**
 * Rebuild Wallet balances from SUCCESS ledger rows (used after cleanup scripts).
 * Mirrors the main code paths that create WalletTransaction rows.
 */
export type WalletBalances = {
  mainBalance: number;
  availableBalance: number;
  collateralBalance: number;
};

export type LedgerRow = {
  amount: number;
  status: string;
  note: string | null;
};

const zeroBalances = (): WalletBalances => ({
  mainBalance: 0,
  availableBalance: 0,
  collateralBalance: 0,
});

export function applyWalletLedgerRow(
  balances: WalletBalances,
  row: LedgerRow,
): void {
  if (row.status !== 'SUCCESS') return;

  const note = (row.note ?? '').toLowerCase();
  const amt = Math.round(Number(row.amount) || 0);
  if (amt === 0) return;

  if (note.includes('cart checkout payment')) {
    const grandTotal = Math.abs(amt);
    const collateralMatch = (row.note ?? '').match(
      /Collateral locked:\s*(\d+)/i,
    );
    const collateral = collateralMatch
      ? parseInt(collateralMatch[1], 10)
      : 0;
    balances.availableBalance -= grandTotal;
    balances.mainBalance -= grandTotal - collateral;
    balances.collateralBalance += collateral;
    return;
  }

  if (
    note.includes('collateral released for returned order') ||
    note.includes('collateral released after dispute resolution')
  ) {
    const release = Math.max(0, amt);
    balances.availableBalance += release;
    balances.collateralBalance = Math.max(
      0,
      balances.collateralBalance - release,
    );
    return;
  }

  if (note.includes('refund issued after dispute resolution')) {
    balances.mainBalance += amt;
    balances.availableBalance += amt;
    return;
  }

  if (note.includes('collateral withheld after dispute resolution')) {
    const debit = Math.abs(amt);
    balances.mainBalance -= debit;
    balances.collateralBalance = Math.max(
      0,
      balances.collateralBalance - debit,
    );
    return;
  }

  if (note.includes('withdrawal request to')) {
    const debit = Math.abs(amt);
    balances.mainBalance -= debit;
    balances.availableBalance -= debit;
    return;
  }

  if (note.includes('refund for rejected withdrawal request')) {
    balances.mainBalance += amt;
    balances.availableBalance += amt;
    return;
  }

  if (amt > 0) {
    balances.mainBalance += amt;
    balances.availableBalance += amt;
    return;
  }

  const debit = Math.abs(amt);
  balances.mainBalance -= debit;
  balances.availableBalance -= debit;
}

export function replayWalletBalancesFromLedger(
  rows: LedgerRow[],
): WalletBalances {
  const balances = zeroBalances();
  for (const row of rows) {
    applyWalletLedgerRow(balances, row);
  }
  balances.collateralBalance = Math.max(0, balances.collateralBalance);
  return balances;
}
