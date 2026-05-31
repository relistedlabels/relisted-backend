import { differenceInMinutes } from 'date-fns';
import {
  buildDefaultDispatchWindow,
  getLagosCalendarDateKey,
  mergeDispatchWindowRanges,
  MIN_DISPATCH_WINDOW_MINUTES,
  parseDispatchWindowFromInput,
  resolveNextReturnPickupWindow,
} from './dispatch-windows';

describe('resale shipment bucketing helpers', () => {
  it('getLagosCalendarDateKey uses Africa/Lagos calendar day', () => {
    const d = new Date('2026-05-15T09:09:00+01:00');
    expect(getLagosCalendarDateKey(d)).toBe('2026-05-15');
  });

  it('buildDefaultDispatchWindow uses a 60-minute slot by default', () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    future.setHours(0, 0, 0, 0);
    const { start, end } = buildDefaultDispatchWindow(future);
    expect(differenceInMinutes(end, start)).toBe(MIN_DISPATCH_WINDOW_MINUTES);
  });

  it('parseDispatchWindowFromInput accepts 1pm–2pm Lagos window', () => {
    const future = new Date();
    future.setDate(future.getDate() + 2);
    const ymd = getLagosCalendarDateKey(future);
    const window = parseDispatchWindowFromInput('OUTBOUND', {
      start: `${ymd}T13:00:00+01:00`,
      end: `${ymd}T14:00:00+01:00`,
    });
    expect(window.start.toISOString()).toContain('T12:00:00.000Z');
    expect(window.end.toISOString()).toContain('T13:00:00.000Z');
  });

  it('resolveNextReturnPickupWindow rolls forward when checkout window passed', () => {
    const pastStart = new Date('2020-01-01T08:00:00+01:00');
    const pastEnd = new Date('2020-01-01T09:00:00+01:00');
    const { window, rescheduled } = resolveNextReturnPickupWindow(new Date(), {
      start: pastStart,
      end: pastEnd,
    });
    expect(rescheduled).toBe(true);
    expect(window.end.getTime()).toBeGreaterThan(Date.now());
    expect(differenceInMinutes(window.end, window.start)).toBe(
      MIN_DISPATCH_WINDOW_MINUTES,
    );
  });

  it('resolveNextReturnPickupWindow keeps a future checkout window', () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const ymd = getLagosCalendarDateKey(future);
    const preferred = {
      start: `${ymd}T10:00:00+01:00`,
      end: `${ymd}T11:00:00+01:00`,
    };
    const { window, rescheduled } = resolveNextReturnPickupWindow(
      new Date(),
      preferred,
    );
    expect(rescheduled).toBe(false);
    expect(window.start.toISOString()).toContain('T09:00:00.000Z');
    expect(window.end.toISOString()).toContain('T10:00:00.000Z');
  });

  it('mergeDispatchWindowRanges spans earliest start and latest end', () => {
    const a = {
      start: new Date('2026-05-15T09:09:00+01:00'),
      end: new Date('2026-05-15T10:09:00+01:00'),
    };
    const b = {
      start: new Date('2026-05-15T09:10:00+01:00'),
      end: new Date('2026-05-15T10:10:00+01:00'),
    };
    const merged = mergeDispatchWindowRanges([a, b]);
    expect(merged.start.getTime()).toBe(a.start.getTime());
    expect(merged.end.getTime()).toBe(b.end.getTime());
  });
});
