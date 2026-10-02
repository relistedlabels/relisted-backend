import {
  calculatePlatformFee,
  computePlatformFee,
  escrowFeeBaseOnReturnConfirm,
  escrowPlatformFee,
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

  it('uses the persisted escrow fee or computes it from the escrow rate', () => {
    expect(
      escrowPlatformFee(
        { platformFeeRate: 5, platformFeeAmount: 0 },
        155,
      ),
    ).toBe(7);
    expect(
      escrowPlatformFee(
        { platformFeeRate: 5, platformFeeAmount: 8 },
        155,
      ),
    ).toBe(8);
  });

  it('does not charge a fee on legacy escrows with no persisted rate', () => {
    expect(
      escrowPlatformFee(
        { platformFeeRate: 0, platformFeeAmount: 0 },
        155,
      ),
    ).toBe(0);
  });

  it('includes cleaning fees in the commissionable rental base', () => {
    expect(escrowPlatformFee(
      {
        platformFeeRate: 10,
        platformFeeAmount: 0,
        rentalAmount: 205,
        cleaningFee: 0,
      },
      205,
    )).toBe(20);
  });

  it('builds rental and return-confirmation fee bases', () => {
    const escrow = { rentalAmount: 100, cleaningFee: 25, resaleAmount: 50 };
    expect(escrowRentalFeeBase(escrow)).toBe(125);
    expect(escrowFeeBaseOnReturnConfirm(escrow)).toBe(175);
  });

  it('adds a fee note only for positive fees', () => {
    expect(platformFeeNoteSuffix(15)).toBe(' (platform fee ₦15)');
    expect(platformFeeNoteSuffix(0)).toBe('');
  });
});
