import { BadRequestException } from '@nestjs/common';
import { differenceInMinutes } from 'date-fns';
import {
  RETURN_DISPATCH_WINDOW_END_HOUR,
  RETURN_DISPATCH_WINDOW_START_HOUR,
  buildDefaultReturnDispatchWindow,
  buildReturnPickupWindowOptions,
  getLagosCalendarDateKey,
  listReturnPickupSlotsForDay,
  MIN_DISPATCH_WINDOW_MINUTES,
  parseReturnPickupWindowChoice,
  resolveNextReturnPickupWindow,
  resolveReturnPickupWindowForSubmit,
} from './dispatch-windows';

const LAGOS = '+01:00';

function lagosIso(ymd: string, hour: number, minute = 0): string {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return `${ymd}T${h}:${m}:00${LAGOS}`;
}

describe('return pickup window selection', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('listReturnPickupSlotsForDay', () => {
    it('returns nine hourly slots (8am–5pm) on a future Lagos day', () => {
      const slots = listReturnPickupSlotsForDay(
        '2026-08-10',
        new Date('2026-08-01T10:00:00+01:00'),
      );
      expect(slots).toHaveLength(9);
      expect(differenceInMinutes(slots[0].end, slots[0].start)).toBe(
        MIN_DISPATCH_WINDOW_MINUTES,
      );
      const firstHour = slots[0].start.toLocaleString('en-US', {
        timeZone: 'Africa/Lagos',
        hour: 'numeric',
        hour12: false,
      });
      expect(Number.parseInt(firstHour, 10)).toBe(
        RETURN_DISPATCH_WINDOW_START_HOUR,
      );
      const lastEndHour = slots[8].end.toLocaleString('en-US', {
        timeZone: 'Africa/Lagos',
        hour: 'numeric',
        hour12: false,
      });
      expect(Number.parseInt(lastEndHour, 10)).toBe(
        RETURN_DISPATCH_WINDOW_END_HOUR,
      );
    });

    it('excludes only slots that have fully ended on the same Lagos day', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T11:30:00+01:00'));

      const slots = listReturnPickupSlotsForDay('2026-06-15');
      const startHours = slots.map((s) =>
        Number.parseInt(
          s.start.toLocaleString('en-US', {
            timeZone: 'Africa/Lagos',
            hour: 'numeric',
            hour12: false,
          }),
          10,
        ),
      );

      expect(startHours).not.toContain(8);
      expect(startHours).not.toContain(9);
      expect(startHours).not.toContain(10);
      expect(startHours).toContain(11);
      expect(startHours).toEqual([11, 12, 13, 14, 15, 16]);
    });

    it('returns only the in-progress last slot when near end of day', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T16:30:00+01:00'));

      const slots = listReturnPickupSlotsForDay('2026-06-15');
      expect(slots).toHaveLength(1);
      const startHour = Number.parseInt(
        slots[0].start.toLocaleString('en-US', {
          timeZone: 'Africa/Lagos',
          hour: 'numeric',
          hour12: false,
        }),
        10,
      );
      expect(startHour).toBe(16);
    });

    it('returns no slots after the last window has ended', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T17:30:00+01:00'));

      const slots = listReturnPickupSlotsForDay('2026-06-15');
      expect(slots).toHaveLength(0);
    });
  });

  describe('buildDefaultReturnDispatchWindow', () => {
    it('picks the next hour slot when called mid-afternoon', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T14:30:00+01:00'));

      const { start, end } = buildDefaultReturnDispatchWindow(new Date());
      expect(getLagosCalendarDateKey(start)).toBe('2026-06-15');
      const startHour = Number.parseInt(
        start.toLocaleString('en-US', {
          timeZone: 'Africa/Lagos',
          hour: 'numeric',
          hour12: false,
        }),
        10,
      );
      expect(startHour).toBe(15);
      expect(differenceInMinutes(end, start)).toBe(MIN_DISPATCH_WINDOW_MINUTES);
    });

    it('rolls to the next day at 8am when called after 5pm', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T18:00:00+01:00'));

      const { start, end } = buildDefaultReturnDispatchWindow(new Date());
      expect(getLagosCalendarDateKey(start)).toBe('2026-06-16');
      const startHour = Number.parseInt(
        start.toLocaleString('en-US', {
          timeZone: 'Africa/Lagos',
          hour: 'numeric',
          hour12: false,
        }),
        10,
      );
      expect(startHour).toBe(RETURN_DISPATCH_WINDOW_START_HOUR);
      expect(differenceInMinutes(end, start)).toBe(MIN_DISPATCH_WINDOW_MINUTES);
    });
  });

  describe('resolveNextReturnPickupWindow', () => {
    it('keeps a future checkout window without rescheduling', () => {
      const reference = new Date('2026-06-01T10:00:00+01:00');
      const preferred = {
        start: new Date('2026-06-20T10:00:00+01:00'),
        end: new Date('2026-06-20T11:00:00+01:00'),
      };

      const { window, rescheduled } = resolveNextReturnPickupWindow(
        reference,
        preferred,
      );

      expect(rescheduled).toBe(false);
      expect(window.start.toISOString()).toBe(preferred.start.toISOString());
      expect(window.end.toISOString()).toBe(preferred.end.toISOString());
    });

    it('rolls forward when the checkout window has passed', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T14:30:00+01:00'));

      const preferred = {
        start: new Date('2026-06-15T09:00:00+01:00'),
        end: new Date('2026-06-15T10:00:00+01:00'),
      };

      const { window, rescheduled } = resolveNextReturnPickupWindow(
        new Date(),
        preferred,
      );

      expect(rescheduled).toBe(true);
      expect(window.end.getTime()).toBeGreaterThan(Date.now());
      expect(getLagosCalendarDateKey(window.start)).toBe('2026-06-15');
    });
  });

  describe('buildReturnPickupWindowOptions', () => {
    it('marks original window expired and suggests a future slot on the same day', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T14:30:00+01:00'));

      const preferred = {
        start: new Date('2026-06-15T09:00:00+01:00'),
        end: new Date('2026-06-15T10:00:00+01:00'),
      };

      const options = buildReturnPickupWindowOptions(new Date(), preferred);

      expect(options.scheduledDay).toBe('2026-06-15');
      expect(options.rescheduled).toBe(true);
      expect(options.originalWindow?.expired).toBe(true);
      expect(options.sameDayOptions.length).toBeGreaterThan(0);
      expect(
        options.sameDayOptions.some((o) => o.start === options.suggested.start),
      ).toBe(true);
      for (const slot of options.sameDayOptions) {
        expect(getLagosCalendarDateKey(new Date(slot.start))).toBe(
          options.scheduledDay,
        );
      }
    });

    it('keeps original window when still valid and lists remaining same-day slots', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T08:30:00+01:00'));

      const preferred = {
        start: new Date('2026-06-15T10:00:00+01:00'),
        end: new Date('2026-06-15T11:00:00+01:00'),
      };

      const options = buildReturnPickupWindowOptions(new Date(), preferred);

      expect(options.rescheduled).toBe(false);
      expect(options.originalWindow?.expired).toBe(false);
      expect(options.suggested.start).toBe(preferred.start.toISOString());
      expect(options.sameDayOptions.length).toBeGreaterThan(1);
    });
  });

  describe('parseReturnPickupWindowChoice', () => {
    const scheduledDay = '2026-08-10';
    const reference = new Date('2026-08-01T10:00:00+01:00');

    it('accepts a valid slot from the same day list', () => {
      const slots = listReturnPickupSlotsForDay(scheduledDay, reference);
      const pick = slots[2];
      const result = parseReturnPickupWindowChoice(
        {
          start: pick.start.toISOString(),
          end: pick.end.toISOString(),
        },
        scheduledDay,
        reference,
      );
      expect(result.start.getTime()).toBe(pick.start.getTime());
    });

    it('rejects a slot on a different Lagos day', () => {
      expect(() =>
        parseReturnPickupWindowChoice(
          {
            start: lagosIso('2026-08-11', 10),
            end: lagosIso('2026-08-11', 11),
          },
          scheduledDay,
          reference,
        ),
      ).toThrow(BadRequestException);
      expect(() =>
        parseReturnPickupWindowChoice(
          {
            start: lagosIso('2026-08-11', 10),
            end: lagosIso('2026-08-11', 11),
          },
          scheduledDay,
          reference,
        ),
      ).toThrow(/scheduled return day/i);
    });

    it('rejects a slot outside return operating hours', () => {
      expect(() =>
        parseReturnPickupWindowChoice(
          {
            start: lagosIso(scheduledDay, 6),
            end: lagosIso(scheduledDay, 7),
          },
          scheduledDay,
          reference,
        ),
      ).toThrow(/must fall between/i);
    });

    it('rejects a slot that is not in the allowed list', () => {
      expect(() =>
        parseReturnPickupWindowChoice(
          {
            start: lagosIso(scheduledDay, 10, 30),
            end: lagosIso(scheduledDay, 11, 30),
          },
          scheduledDay,
          reference,
        ),
      ).toThrow(/not available/i);
    });

    it('rejects a slot whose end is already in the past', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T12:30:00+01:00'));

      expect(() =>
        parseReturnPickupWindowChoice(
          {
            start: lagosIso('2026-06-15', 11),
            end: lagosIso('2026-06-15', 12),
          },
          '2026-06-15',
          new Date(),
        ),
      ).toThrow(/already passed/i);
    });
  });

  describe('resolveReturnPickupWindowForSubmit', () => {
    it('uses the suggested slot when no explicit choice is sent', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T14:30:00+01:00'));

      const preferred = {
        start: new Date('2026-06-15T09:00:00+01:00'),
        end: new Date('2026-06-15T10:00:00+01:00'),
      };

      const resolved = resolveReturnPickupWindowForSubmit(
        new Date(),
        preferred,
        null,
      );

      expect(resolved.rescheduled).toBe(true);
      expect(resolved.scheduledDay).toBe('2026-06-15');
      expect(resolved.window.end.getTime()).toBeGreaterThan(Date.now());
    });

    it('uses an explicit same-day choice from the options list', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T14:30:00+01:00'));

      const preferred = {
        start: new Date('2026-06-15T09:00:00+01:00'),
        end: new Date('2026-06-15T10:00:00+01:00'),
      };
      const options = buildReturnPickupWindowOptions(new Date(), preferred);
      const alternate =
        options.sameDayOptions.find(
          (o) => o.start !== options.suggested.start,
        ) ?? options.suggested;

      const resolved = resolveReturnPickupWindowForSubmit(new Date(), preferred, {
        start: alternate.start,
        end: alternate.end,
      });

      expect(resolved.window.start.toISOString()).toBe(
        new Date(alternate.start).toISOString(),
      );
      expect(resolved.scheduledDay).toBe('2026-06-15');
    });

    it('marks rescheduled when renter picks a different slot than the valid checkout window', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T08:30:00+01:00'));

      const preferred = {
        start: new Date('2026-06-15T10:00:00+01:00'),
        end: new Date('2026-06-15T11:00:00+01:00'),
      };
      const options = buildReturnPickupWindowOptions(new Date(), preferred);
      const alternate =
        options.sameDayOptions.find(
          (o) => o.start !== options.suggested.start,
        ) ?? options.suggested;

      const resolved = resolveReturnPickupWindowForSubmit(new Date(), preferred, {
        start: alternate.start,
        end: alternate.end,
      });

      expect(resolved.rescheduled).toBe(true);
    });
  });
});
