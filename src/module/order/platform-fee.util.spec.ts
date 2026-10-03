import { EscrowStatus } from '@prisma/client';
import {
  calculatePlatformFee,
  computePlatformFee,
  escrowFeeBaseAlreadyReleased,
  escrowFeeBaseOnReturnConfirm,
  escrowPlatformFee,
  escrowPlatformFeeDue,
  escrowRentalFeeBase,
  getListerPlatformFeePercent,
  platformFeeNoteSuffix,
} from './platform-fee.util';

describe('calculatePlatformFee', () => {
  it('floors fractional naira instead of rounding up', () => {
    expect(calculatePlatformFee(155)).toBe(15);
  });

  it('keeps whole-naira fees unchanged', () => {
    expect(calculatePlatformFee(150)).toBe(15);
  });

  it('uses the configured lister rate with a ten-percent default', () => {
    expect(getListerPlatformFeePercent()).toBe(10);
    expect(computePlatformFee(155, 5)).toBe(7);
  });

  it('computes the cumulative fee from the snapshotted escrow rate', () => {
    expect(
      escrowPlatformFee({ platformFeeRate: 5, platformFeeAmount: 8 }, 155),
    ).toBe(7);
  });

  it('charges only the remaining fee after a rental payout before resale', () => {
    const escrow = {
      status: EscrowStatus.PARTIALLY_RELEASED,
      platformFeeRate: 10,
      platformFeeAmount: 10_000,
      rentalAmount: 110_000,
      cleaningFee: 10_000,
      resaleReleasedAmount: 0,
    };

    expect(escrowFeeBaseAlreadyReleased(escrow)).toBe(100_000);
    expect(escrowPlatformFeeDue(escrow, 120_000)).toBe(2_000);
  });

  it('charges the remaining cumulative fee across split resale payouts', () => {
    const escrow = {
      status: EscrowStatus.LOCKED,
      platformFeeRate: 10,
      platformFeeAmount: 1_000,
      rentalAmount: 0,
      cleaningFee: 0,
      resaleReleasedAmount: 10_000,
    };

    expect(escrowFeeBaseAlreadyReleased(escrow)).toBe(10_000);
    expect(escrowPlatformFeeDue(escrow, 100_000)).toBe(9_000);
  });

  it('does not charge a fee on legacy escrows with no persisted rate', () => {
    expect(
      escrowPlatformFee({ platformFeeRate: 0, platformFeeAmount: 0 }, 155),
    ).toBe(0);
  });

  it('excludes cleaning fees from the commissionable rental base', () => {
    const escrow = {
      platformFeeRate: 10,
      platformFeeAmount: 0,
      rentalAmount: 4205,
      cleaningFee: 4000,
    };
    expect(escrowRentalFeeBase(escrow)).toBe(205);
    expect(escrowPlatformFee(escrow, escrowRentalFeeBase(escrow))).toBe(20);
  });

  it('excludes cleaning from rental fees and adds resale proceeds when applicable', () => {
    const escrow = {
      rentalAmount: 4205,
      cleaningFee: 4000,
      resaleAmount: 50,
    };
    expect(escrowRentalFeeBase(escrow)).toBe(205);
    expect(escrowFeeBaseOnReturnConfirm(escrow)).toBe(255);
  });

  it('does not include collateral in the rental fee base', () => {
    const escrow = {
      rentalAmount: 4205,
      cleaningFee: 4000,
      collateralAmount: 8000,
    };
    expect(
      escrowPlatformFee(
        { platformFeeRate: 10, platformFeeAmount: 0 },
        escrowRentalFeeBase(escrow),
      ),
    ).toBe(20);
    expect(
      escrowPlatformFee(
        { platformFeeRate: 10, platformFeeAmount: 0 },
        escrowFeeBaseOnReturnConfirm({
          ...escrow,
          resaleAmount: 10000,
        }),
      ),
    ).toBe(1020);
  });

  it('adds a fee note only for positive fees', () => {
    expect(platformFeeNoteSuffix(15)).toBe(' (platform fee ₦15)');
    expect(platformFeeNoteSuffix(0)).toBe('');
  });
});
