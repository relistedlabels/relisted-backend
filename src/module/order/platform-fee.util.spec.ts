import {
  computePlatformFee,
  escrowFeeBaseOnReturnConfirm,
  escrowPlatformFee,
  escrowRentalFeeBase,
  getListerPlatformFeePercent,
  platformFeeNoteSuffix,
} from './platform-fee.util';

describe('platform-fee.util', () => {
  const OLD = process.env.LISTER_PLATFORM_FEE_PERCENT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.LISTER_PLATFORM_FEE_PERCENT;
    else process.env.LISTER_PLATFORM_FEE_PERCENT = OLD;
  });

  it('defaults to 10% and honours env override', () => {
    delete process.env.LISTER_PLATFORM_FEE_PERCENT;
    expect(getListerPlatformFeePercent()).toBe(10);
    process.env.LISTER_PLATFORM_FEE_PERCENT = '0';
    expect(getListerPlatformFeePercent()).toBe(0);
    process.env.LISTER_PLATFORM_FEE_PERCENT = 'abc';
    expect(getListerPlatformFeePercent()).toBe(10);
  });

  it('computes whole-naira fees', () => {
    expect(computePlatformFee(25000, 10)).toBe(2500);
    expect(computePlatformFee(1005, 10)).toBe(101);
    expect(computePlatformFee(5000, 0)).toBe(0);
    expect(computePlatformFee(-5, 10)).toBe(0);
  });

  it('excludes cleaning from the rental fee base', () => {
    expect(escrowRentalFeeBase({ rentalAmount: 25000, cleaningFee: 5000 })).toBe(
      20000,
    );
  });

  it('charges nothing on legacy escrows (rate 0)', () => {
    expect(escrowPlatformFee({ platformFeeRate: 0 }, 20000)).toBe(0);
    expect(escrowPlatformFee({}, 20000)).toBe(0);
  });

  it('computes the return-confirm fee base by escrow state', () => {
    const base = {
      rentalAmount: 25000,
      cleaningFee: 5000,
      collateralAmount: 50000,
      resaleAmount: 30000,
      resaleReleasedAmount: 10000,
    };
    expect(escrowFeeBaseOnReturnConfirm({ ...base, status: 'LOCKED' })).toBe(
      40000,
    );
    expect(
      escrowFeeBaseOnReturnConfirm({ ...base, status: 'PARTIALLY_RELEASED' }),
    ).toBe(20000);
    expect(escrowFeeBaseOnReturnConfirm({ ...base, status: 'RELEASED' })).toBe(0);
  });

  it('formats the ledger note suffix', () => {
    expect(platformFeeNoteSuffix(0)).toBe('');
    expect(platformFeeNoteSuffix(2500)).toContain('platform fee');
  });
});
