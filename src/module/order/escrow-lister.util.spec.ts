import {
  listerEscrowDisplaySummary,
  listerEscrowPayoutOnReturnConfirm,
} from './escrow-lister.util';

describe('escrow-lister.util', () => {
  const base = {
    rentalAmount: 5500,
    cleaningFee: 500,
    collateralAmount: 10000,
    resaleAmount: 2000,
    resaleReleasedAmount: 0,
  };

  it('pays rental+resale when LOCKED (cleaning already in rentalAmount)', () => {
    expect(
      listerEscrowPayoutOnReturnConfirm({ ...base, status: 'LOCKED' }),
    ).toBe(7500);
  });

  it('pays only remaining resale when PARTIALLY_RELEASED', () => {
    expect(
      listerEscrowPayoutOnReturnConfirm({
        ...base,
        status: 'PARTIALLY_RELEASED',
      }),
    ).toBe(2000);
  });

  it('splits rental vs cleaning for display', () => {
    const d = listerEscrowDisplaySummary({ ...base, status: 'LOCKED' });
    expect(d.rentalFeeTotal).toBe(5000);
    expect(d.cleaningFeeTotal).toBe(500);
    expect(d.totalHeld).toBe(17500);
  });
});
