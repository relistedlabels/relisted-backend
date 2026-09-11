import {
  buildTopshipSenderDetail,
  resolveTopshipCityName,
} from './topship-city';

describe('resolveTopshipCityName', () => {
  it('maps Ogba to OGBA', () => {
    expect(
      resolveTopshipCityName({
        city: 'Ogba',
        state: 'Lagos',
        street: '1 adebiyi street',
      }),
    ).toBe('OGBA');
  });

  it('maps Ikoyi to IKOYI', () => {
    expect(
      resolveTopshipCityName({
        city: 'Ikoyi',
        state: 'Lagos',
        street: '34 Bourdillon',
      }),
    ).toBe('IKOYI');
  });

  it('maps Lekki to LEKKI', () => {
    expect(
      resolveTopshipCityName({
        city: 'Lekki',
        state: 'Lagos',
        street: '26a Dele Adedeji street, Lekki Phase One',
      }),
    ).toBe('LEKKI');
  });

  it('passes through canonical Topship names', () => {
    expect(
      resolveTopshipCityName({ city: 'lagos mainland', state: 'Lagos' }),
    ).toBe('LAGOS MAINLAND');
  });
});

describe('buildTopshipSenderDetail', () => {
  it('uses IKOYI in payload for Bourdillon address', () => {
    const detail = buildTopshipSenderDetail({
      street: '34 Bourdillon, Ikoyi',
      city: 'Ikoyi',
      state: 'Lagos',
    });
    expect(detail.city).toBe('IKOYI');
    expect(detail.addressLine1).toBe('34 Bourdillon, Ikoyi');
  });
});
