import { EscrowStatus, type Escrow } from '@prisma/client';

export function getListerPlatformFeePercent(): number {
  const configuredRate = Number(process.env.LISTER_PLATFORM_FEE_PERCENT);
  return Number.isFinite(configuredRate) && configuredRate >= 0
    ? configuredRate
    : 10;
}

/** Platform service fee rounded down to a whole naira. */
export function computePlatformFee(
  amount: number,
  percent = getListerPlatformFeePercent(),
): number {
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(percent) ||
    percent <= 0
  ) {
    return 0;
  }
  return Math.floor((amount * percent) / 100);
}

/** Commission base for rental income only; excludes cleaning and collateral. */
export function escrowRentalFeeBase(
  escrow: Pick<Escrow, 'rentalAmount' | 'cleaningFee'>,
): number {
  return Math.max(
    0,
    Number(escrow.rentalAmount ?? 0) - Number(escrow.cleaningFee ?? 0),
  );
}

export function escrowFeeBaseOnReturnConfirm(
  escrow: Pick<Escrow, 'rentalAmount' | 'cleaningFee' | 'resaleAmount'>,
): number {
  return escrowRentalFeeBase(escrow) + Number(escrow.resaleAmount ?? 0);
}

/** Total fee due at the configured rate for the cumulative commissionable base. */
export function escrowPlatformFee(
  escrow: Pick<Escrow, 'platformFeeRate' | 'platformFeeAmount'>,
  cumulativeFeeBase: number,
): number {
  const persistedRate = Number(escrow.platformFeeRate ?? 0);
  if (persistedRate <= 0) return 0;
  return computePlatformFee(cumulativeFeeBase, persistedRate);
}

/** Fee still due after applying fees already withheld from prior escrow releases. */
export function escrowPlatformFeeDue(
  escrow: Pick<Escrow, 'platformFeeRate' | 'platformFeeAmount'>,
  cumulativeFeeBase: number,
): number {
  return Math.max(
    0,
    escrowPlatformFee(escrow, cumulativeFeeBase) -
      Math.max(0, Number(escrow.platformFeeAmount ?? 0)),
  );
}

/** Commissionable base already released from this escrow. */
export function escrowFeeBaseAlreadyReleased(
  escrow: Pick<
    Escrow,
    'status' | 'rentalAmount' | 'cleaningFee' | 'resaleReleasedAmount'
  >,
): number {
  const releasedRentalBase =
    escrow.status === EscrowStatus.PARTIALLY_RELEASED
      ? escrowRentalFeeBase(escrow)
      : 0;
  return releasedRentalBase + Math.max(0, escrow.resaleReleasedAmount ?? 0);
}

export function platformFeeNoteSuffix(platformFee: number): string {
  return platformFee > 0 ? ` (platform fee ₦${platformFee})` : '';
}

export function calculatePlatformFee(amount: number): number {
  return computePlatformFee(amount, 10);
}
