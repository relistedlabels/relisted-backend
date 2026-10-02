import { calculatePlatformFee } from './platform-fee.util';

describe('calculatePlatformFee', () => {
  it('floors fractional naira instead of rounding up', () => {
    expect(calculatePlatformFee(155)).toBe(15);
  });

  it('keeps whole-naira fees unchanged', () => {
    expect(calculatePlatformFee(150)).toBe(15);
  });
});
