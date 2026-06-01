/** Checkout stores rent + cleaning in `rentalAmount`; `cleaningFee` is the same cleaning total again. */
export type ListerEscrowRow = {
  status: string;
  rentalAmount: number;
  cleaningFee: number;
  collateralAmount: number;
  resaleAmount: number | null;
  resaleReleasedAmount?: number | null;
};

export function listerEscrowResaleRemaining(escrow: ListerEscrowRow): number {
  const resale = Math.max(0, Number(escrow.resaleAmount || 0));
  const released = Math.max(0, Number(escrow.resaleReleasedAmount || 0));
  return Math.max(0, resale - released);
}

/** Wallet credit for this lister when they confirm return receipt. */
export function listerEscrowPayoutOnReturnConfirm(escrow: ListerEscrowRow): number {
  const st = String(escrow.status ?? '');
  if (st === 'RELEASED') return 0;
  const resaleRemaining = listerEscrowResaleRemaining(escrow);
  if (st === 'PARTIALLY_RELEASED') {
    return resaleRemaining;
  }
  return Math.max(0, Number(escrow.rentalAmount || 0)) + resaleRemaining;
}

/** Lister-facing escrow summary (amounts held / earned for this lister only). */
export function listerEscrowDisplaySummary(escrow: ListerEscrowRow) {
  const rentalStored = Math.max(0, Number(escrow.rentalAmount || 0));
  const cleaning = Math.max(0, Number(escrow.cleaningFee || 0));
  const rentalFees = Math.max(0, rentalStored - cleaning);
  const resale = Math.max(0, Number(escrow.resaleAmount || 0));
  const collateral = Math.max(0, Number(escrow.collateralAmount || 0));

  return {
    rentalFeeTotal: rentalFees,
    cleaningFeeTotal: cleaning,
    itemValueHeld: collateral,
    purchasePrice: resale,
    totalHeld: rentalStored + resale + collateral,
  };
}
