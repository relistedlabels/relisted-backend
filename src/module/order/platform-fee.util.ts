import type { ListerEscrowRow } from './escrow-lister.util';
import { listerEscrowResaleRemaining } from './escrow-lister.util';

/** Default lister commission (%) applied to new orders. Override with LISTER_PLATFORM_FEE_PERCENT; 0 disables. */
export const DEFAULT_LISTER_PLATFORM_FEE_PERCENT = 10;

export function getListerPlatformFeePercent(): number {
  const raw = process.env.LISTER_PLATFORM_FEE_PERCENT?.trim();
  if (!raw) return DEFAULT_LISTER_PLATFORM_FEE_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return DEFAULT_LISTER_PLATFORM_FEE_PERCENT;
  }
  return n;
}

/** Whole-naira commission on `base`, never more than `base`. */
export function computePlatformFee(base: number, ratePercent: number): number {
  const b = Math.max(0, Math.round(Number(base) || 0));
  const r = Math.max(0, Number(ratePercent) || 0);
  if (b === 0 || r === 0) return 0;
  return Math.min(b, Math.round((b * r) / 100));
}

type FeeEscrowRow = ListerEscrowRow & { platformFeeRate?: number | null };

/** Rental charge only: `rentalAmount` bundles cleaning, which is not commissionable. */
export function escrowRentalFeeBase(escrow: {
  rentalAmount: number;
  cleaningFee: number;
}): number {
  return Math.max(
    0,
    Math.max(0, Number(escrow.rentalAmount || 0)) -
      Math.max(0, Number(escrow.cleaningFee || 0)),
  );
}

/** Commissionable amount released when the lister confirms return receipt. */
export function escrowFeeBaseOnReturnConfirm(escrow: FeeEscrowRow): number {
  const st = String(escrow.status ?? '');
  if (st === 'RELEASED') return 0;
  const resale = listerEscrowResaleRemaining(escrow);
  return st === 'PARTIALLY_RELEASED'
    ? resale
    : escrowRentalFeeBase(escrow) + resale;
}

export function escrowPlatformFee(
  escrow: { platformFeeRate?: number | null },
  base: number,
): number {
  return computePlatformFee(base, escrow.platformFeeRate ?? 0);
}

export function platformFeeNoteSuffix(fee: number): string {
  return fee > 0 ? ` (net of ₦${fee.toLocaleString('en-NG')} platform fee)` : '';
}
