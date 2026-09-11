import {
  normalizeTshipCountryCode,
  normalizeTshipPhone,
  resolveTshipCity,
} from './tship-address-normalize';

describe('tship address normalize', () => {
  it('maps Nigeria to NG', () => {
    expect(normalizeTshipCountryCode('Nigeria')).toBe('NG');
  });

  it('maps Ogba to Lagos for Terminal city validation', () => {
    expect(resolveTshipCity('Ogba', 'Lagos')).toBe('Lagos');
    expect(resolveTshipCity('Ikoyi', 'Lagos')).toBe('Ikoyi');
  });

  it('normalizes long NG phone to 10 national digits', () => {
    const out = normalizeTshipPhone('+234802424242444');
    expect(out.startsWith('+234')).toBe(true);
    expect(out.replace(/\D/g, '').length).toBe(13);
  });
});
