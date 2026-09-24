import {
  computeReturnRequestReminderActions,
  toLagosDateKey,
  type ReturnRequestReminderLegState,
  type ReturnRequestReminderState,
} from './return-request-reminder.util';

const config = {
  preWindowMorningHour: 8,
  pastDueMorningHour: 8,
  pastDueAfternoonHour: 14,
  pastDueEveningHour: 20,
};

function baseLeg(
  overrides: Partial<ReturnRequestReminderLegState> = {},
): ReturnRequestReminderLegState {
  return {
    scheduledWindowStart: null,
    scheduledWindowEnd: null,
    returnRequestReminderState: null,
    ...overrides,
  };
}

function withSent(
  sent: ReturnRequestReminderState['sent'],
  overrides: Partial<ReturnRequestReminderLegState> = {},
): ReturnRequestReminderLegState {
  return baseLeg({
    returnRequestReminderState: { sent },
    ...overrides,
  });
}

/** Build a Date at a given Lagos local hour on a fixed UTC instant (approx via offset). */
function lagosLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 1, minute, 0));
}

describe('computeReturnRequestReminderActions', () => {
  it('fires 24_hours_before when window is ~24h away on a different Lagos day', () => {
    const start = lagosLocal(2026, 6, 10, 14);
    const now = lagosLocal(2026, 6, 9, 14);
    const actions = computeReturnRequestReminderActions(
      now,
      baseLeg({
        scheduledWindowStart: start,
        scheduledWindowEnd: lagosLocal(2026, 6, 10, 17),
      }),
      config,
    );
    expect(actions.map((a) => a.type)).toContain('24_hours_before');
  });

  it('fires morning_of on window day at or after 8 AM Lagos', () => {
    const start = lagosLocal(2026, 6, 10, 14);
    const now = lagosLocal(2026, 6, 10, 8);
    const actions = computeReturnRequestReminderActions(
      now,
      baseLeg({
        scheduledWindowStart: start,
        scheduledWindowEnd: lagosLocal(2026, 6, 10, 17),
      }),
      config,
    );
    expect(actions.map((a) => a.type)).toContain('morning_of');
  });

  it('does not fire hourly reminders', () => {
    const start = lagosLocal(2026, 6, 10, 14);
    const morningSent = lagosLocal(2026, 6, 10, 8);
    const now = lagosLocal(2026, 6, 10, 10);
    const actions = computeReturnRequestReminderActions(
      now,
      withSent({ morning_of: morningSent.toISOString() }, {
        scheduledWindowStart: start,
        scheduledWindowEnd: lagosLocal(2026, 6, 10, 17),
      }),
      config,
    );
    expect(actions.map((a) => a.type)).not.toContain('hourly');
  });

  it('fires 15_minutes within tolerance', () => {
    const start = lagosLocal(2026, 6, 10, 14);
    const now = new Date(start.getTime() - 16 * 60 * 1000);
    const actions = computeReturnRequestReminderActions(
      now,
      baseLeg({
        scheduledWindowStart: start,
        scheduledWindowEnd: lagosLocal(2026, 6, 10, 17),
      }),
      config,
    );
    expect(actions.map((a) => a.type)).toContain('15_minutes');
    expect(actions.map((a) => a.type)).not.toContain('30_minutes');
    expect(actions.map((a) => a.type)).not.toContain('5_minutes');
  });

  it('fires past_due_morning after window end on a new day', () => {
    const end = lagosLocal(2026, 6, 10, 17);
    const now = lagosLocal(2026, 6, 11, 8);
    const actions = computeReturnRequestReminderActions(
      now,
      baseLeg({
        scheduledWindowStart: lagosLocal(2026, 6, 10, 14),
        scheduledWindowEnd: end,
      }),
      config,
    );
    expect(actions).toEqual([
      { type: 'past_due_morning', incrementPastDueDay: true },
    ]);
  });

  it('does not fire afternoon or evening past-due reminders', () => {
    const end = lagosLocal(2026, 6, 10, 12);
    const now = lagosLocal(2026, 6, 10, 14);
    const actions = computeReturnRequestReminderActions(
      now,
      withSent(
        { past_due_morning: lagosLocal(2026, 6, 10, 8).toISOString() },
        {
          scheduledWindowStart: lagosLocal(2026, 6, 10, 8),
          scheduledWindowEnd: end,
        },
      ),
      config,
    );
    expect(actions).toEqual([]);
  });
});

describe('toLagosDateKey', () => {
  it('formats a Lagos calendar date', () => {
    const d = lagosLocal(2026, 6, 9, 12);
    expect(toLagosDateKey(d)).toMatch(/2026-06-09/);
  });
});
