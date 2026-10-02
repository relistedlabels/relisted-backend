import type { Escrow } from '@prisma/client';

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

export function escrowRentalFeeBase(
  escrow: Pick<Escrow, 'rentalAmount' | 'cleaningFee'>,
): number {
  return Number(escrow.rentalAmount ?? 0) + Number(escrow.cleaningFee ?? 0);
}

export function escrowFeeBaseOnReturnConfirm(
  escrow: Pick<Escrow, 'rentalAmount' | 'cleaningFee' | 'resaleAmount'>,
): number {
  return (
    Number(escrow.rentalAmount ?? 0) +
    Number(escrow.cleaningFee ?? 0) +
    Number(escrow.resaleAmount ?? 0)
  );
}

export function escrowPlatformFee(
  escrow: Pick<Escrow, 'platformFeeRate' | 'platformFeeAmount'>,
  fallbackBase: number,
): number {
  const persistedFee = Number(escrow.platformFeeAmount ?? 0);
  if (persistedFee > 0) return persistedFee;
  const persistedRate = Number(escrow.platformFeeRate ?? 0);
  if (persistedRate <= 0) return 0;
  return computePlatformFee(fallbackBase, persistedRate);
}

export function platformFeeNoteSuffix(platformFee: number): string {
  return platformFee > 0 ? ` (platform fee ₦${platformFee})` : '';
}

export function calculatePlatformFee(amount: number): number {
  return computePlatformFee(amount, 10);
}
