import {
  formatDateTimeLagos,
  formatDispatchWindowCompact,
  formatDispatchWindowLagos,
  formatRentalBoundaryDateLagos,
  formatRentalPeriodCompact,
  formatOrdinalDay,
} from './dispatch-window-format';

describe('dispatch-window-format', () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'UTC';
  });

  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it('formatDateTimeLagos uses WAT on a UTC server', () => {
    expect(formatDateTimeLagos('2026-06-25T10:00:00.000Z')).toMatch(
      /Thu,?\s+25 Jun,?\s+11:00/,
    );
    expect(formatDateTimeLagos('2026-06-26T10:00:00.000Z')).toMatch(
      /Fri,?\s+26 Jun,?\s+11:00/,
    );
  });

  it('formatDispatchWindowLagos keeps start and end on the same Lagos day', () => {
    const summary = formatDispatchWindowLagos(
      new Date('2026-06-26T10:00:00.000Z'),
      new Date('2026-06-26T11:00:00.000Z'),
    );
    expect(summary).toContain('Fri');
    expect(summary).toContain('26 Jun');
    expect(summary).toContain('11:00');
    expect(summary).toContain('12:00');
  });

  it('formatRentalBoundaryDateLagos treats YYYY-MM-DD as a Lagos calendar day', () => {
    expect(formatRentalBoundaryDateLagos('2026-06-25')).toMatch(/25 Jun 2026/);
  });

  it('formatRentalPeriodCompact uses ordinals and full month without year', () => {
    expect(
      formatRentalPeriodCompact('2026-06-10', '2026-06-13'),
    ).toBe('10th–13th June');
  });

  it('formatDispatchWindowCompact uses ordinals and full month', () => {
    expect(
      formatDispatchWindowCompact(
        new Date('2026-06-09T09:00:00+01:00'),
        new Date('2026-06-09T14:00:00+01:00'),
      ),
    ).toBe('9th June, 9 am – 2 pm WAT');
  });

  it('formatOrdinalDay handles teens and regular ordinals', () => {
    expect(formatOrdinalDay(1)).toBe('1st');
    expect(formatOrdinalDay(2)).toBe('2nd');
    expect(formatOrdinalDay(3)).toBe('3rd');
    expect(formatOrdinalDay(11)).toBe('11th');
  });
});
