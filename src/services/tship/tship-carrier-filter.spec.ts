import {
  isAllowedTshipCarrier,
  isEligibleTshipQuoteRate,
  isSameDayTshipRate,
} from './tship-carrier-filter';

describe('tship carrier filter', () => {
  it('allows kwik and gigl same-day rates', () => {
    const kwik = {
      carrier_slug: 'kwik',
      carrier_name: 'Kwik',
      delivery_time: 'Within 4 hours',
      delivery_eta: 240,
    };
    expect(isAllowedTshipCarrier(kwik)).toBe(true);
    expect(isSameDayTshipRate(kwik)).toBe(true);
    expect(isEligibleTshipQuoteRate(kwik, { sameDayOnly: true })).toBe(true);

    const gigl = {
      carrier_slug: 'gigl',
      carrier_name: 'GIG Logistics',
      delivery_time: 'Same day',
    };
    expect(isEligibleTshipQuoteRate(gigl, { sameDayOnly: true })).toBe(true);
  });

  it('blocks fez and dellyman even when ETA looks fast', () => {
    const fez = {
      carrier_slug: 'fez-delivery',
      delivery_time: 'Within 4 hours',
      delivery_eta: 240,
    };
    expect(isEligibleTshipQuoteRate(fez, { sameDayOnly: true })).toBe(false);

    const dellyman = {
      carrier_name: 'Dellyman',
      delivery_time: 'Same day',
    };
    expect(isEligibleTshipQuoteRate(dellyman, { sameDayOnly: true })).toBe(
      false,
    );
  });

  it('rejects multi-day ETAs for same-day checkout', () => {
    const kwikSlow = {
      carrier_slug: 'kwik',
      delivery_time: 'Within 5 days',
      delivery_eta: 7200,
    };
    expect(isEligibleTshipQuoteRate(kwikSlow, { sameDayOnly: true })).toBe(
      false,
    );
    expect(isEligibleTshipQuoteRate(kwikSlow, { sameDayOnly: false })).toBe(
      true,
    );
  });
});
