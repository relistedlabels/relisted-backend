import {
  formatDateTimeLagos,
  formatDispatchWindowLagos,
  formatRentalBoundaryDateLagos,
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
});
