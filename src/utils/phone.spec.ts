import {
  isValidPhoneNumber,
  normalizePhoneNumber,
  normalizePhoneOrThrow,
} from './phone';

describe('phone utils', () => {
  it('normalizes Nigerian numbers with country code', () => {
    expect(normalizePhoneNumber('+2348012345678')).toBe('+2348012345678');
  });

  it('normalizes Nigerian numbers with leading zero', () => {
    expect(normalizePhoneNumber('08012345678')).toBe('+2348012345678');
  });

  it('rejects incomplete numbers', () => {
    expect(normalizePhoneNumber('+234801')).toBeNull();
    expect(isValidPhoneNumber('+234')).toBe(false);
  });

  it('rejects non-Nigerian numbers', () => {
    expect(normalizePhoneNumber('+233201234567')).toBeNull();
    expect(normalizePhoneNumber('+254712345678')).toBeNull();
  });

  it('normalizePhoneOrThrow throws for invalid input', () => {
    expect(() => normalizePhoneOrThrow('+234801')).toThrow(
      'Enter a valid Nigerian phone number.',
    );
  });

  it('normalizePhoneOrThrow returns normalized value', () => {
    expect(normalizePhoneOrThrow('08012345678')).toBe('+2348012345678');
  });
});
