import type { PrismaService } from 'src/services/prisma/prisma.service';

const LAGOS_TZ = 'Africa/Lagos';
const MS_HOUR = 60 * 60 * 1000;
const MS_MINUTE = 60 * 1000;

export type ReturnRequestReminderType =
  | '24_hours_before'
  | 'morning_of'
  | 'hourly'
  | '30_minutes'
  | '15_minutes'
  | '5_minutes'
  | 'past_due_morning'
  | 'past_due_afternoon'
  | 'past_due_evening';

type TimestampStage = Exclude<ReturnRequestReminderType, 'hourly'>;

export type ReturnRequestReminderState = {
  sent?: Partial<Record<TimestampStage, string>>;
  hourly?: string[];
  pastDueDaysNotified?: number;
};

export type ReturnRequestReminderAction = {
  type: ReturnRequestReminderType;
  incrementPastDueDay?: boolean;
  hourlyKey?: string;
};

export type ReturnRequestReminderLegState = {
  scheduledWindowStart: Date | string | null;
  scheduledWindowEnd: Date | string | null;
  returnRequestReminderState?: unknown;
};

export type ReturnRequestReminderConfig = {
  preWindowMorningHour: number;
  pastDueMorningHour: number;
  pastDueAfternoonHour: number;
  pastDueEveningHour: number;
};

const MINUTE_STAGES: Array<{
  type: TimestampStage;
  minutes: number;
  tolerance: number;
}> = [
  { type: '30_minutes', minutes: 30, tolerance: 5 },
  { type: '15_minutes', minutes: 15, tolerance: 3 },
  { type: '5_minutes', minutes: 5, tolerance: 2 },
];

const PAST_DUE_SLOTS: Array<{
  type: TimestampStage;
  hourKey: keyof ReturnRequestReminderConfig;
  incrementDay?: boolean;
}> = [
  { type: 'past_due_morning', hourKey: 'pastDueMorningHour', incrementDay: true },
  { type: 'past_due_afternoon', hourKey: 'pastDueAfternoonHour' },
  { type: 'past_due_evening', hourKey: 'pastDueEveningHour' },
];

const lagosDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: LAGOS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const lagosHourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: LAGOS_TZ,
  hour: '2-digit',
  hour12: false,
});

export function toLagosDateKey(date: Date): string {
  return lagosDateFmt.format(date);
}

export function toLagosHour(date: Date): number {
  return Number(lagosHourFmt.format(date));
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseReturnRequestReminderState(
  raw: unknown,
): ReturnRequestReminderState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as ReturnRequestReminderState;
  return {
    sent: o.sent && typeof o.sent === 'object' ? o.sent : undefined,
    hourly: Array.isArray(o.hourly)
      ? o.hourly.filter((k): k is string => typeof k === 'string')
      : undefined,
    pastDueDaysNotified:
      typeof o.pastDueDaysNotified === 'number' ? o.pastDueDaysNotified : 0,
  };
}

export function getPastDueDaysNotified(raw: unknown): number {
  return parseReturnRequestReminderState(raw).pastDueDaysNotified ?? 0;
}

function sentAt(state: ReturnRequestReminderState, type: TimestampStage): Date | null {
  return toDate(state.sent?.[type] ?? null);
}

function sentToday(state: ReturnRequestReminderState, type: TimestampStage, now: Date): boolean {
  const sent = sentAt(state, type);
  return sent ? toLagosDateKey(sent) === toLagosDateKey(now) : false;
}

export function applyReturnRequestReminderState(
  raw: unknown,
  action: ReturnRequestReminderAction,
  now: Date,
): ReturnRequestReminderState {
  const state = parseReturnRequestReminderState(raw);
  if (action.type === 'hourly' && action.hourlyKey) {
    return { ...state, hourly: [...(state.hourly ?? []), action.hourlyKey] };
  }
  return {
    ...state,
    sent: { ...state.sent, [action.type]: now.toISOString() },
    pastDueDaysNotified: action.incrementPastDueDay
      ? (state.pastDueDaysNotified ?? 0) + 1
      : state.pastDueDaysNotified ?? 0,
  };
}

export function computeReturnRequestReminderActions(
  now: Date,
  leg: ReturnRequestReminderLegState,
  config: ReturnRequestReminderConfig,
): ReturnRequestReminderAction[] {
  const windowStart = toDate(leg.scheduledWindowStart);
  const windowEnd = toDate(leg.scheduledWindowEnd);
  if (!windowStart) return [];

  const state = parseReturnRequestReminderState(leg.returnRequestReminderState);
  const actions: ReturnRequestReminderAction[] = [];
  const nowDate = toLagosDateKey(now);
  const nowHour = toLagosHour(now);
  const msToStart = windowStart.getTime() - now.getTime();

  if (msToStart > 0) {
    const isWindowToday = toLagosDateKey(windowStart) === nowDate;

    if (
      !sentAt(state, '24_hours_before') &&
      msToStart > 23 * MS_HOUR &&
      msToStart <= 25 * MS_HOUR &&
      !isWindowToday
    ) {
      actions.push({ type: '24_hours_before' });
    }

    if (
      !sentAt(state, 'morning_of') &&
      isWindowToday &&
      nowHour >= config.preWindowMorningHour
    ) {
      actions.push({ type: 'morning_of' });
    }

    const morningSent = sentAt(state, 'morning_of');
    if (morningSent && msToStart > MS_HOUR) {
      const hourlyStop = windowStart.getTime() - MS_HOUR;
      if (
        windowStart.getTime() - morningSent.getTime() > MS_HOUR &&
        now >= morningSent &&
        now.getTime() <= hourlyStop &&
        nowHour > toLagosHour(morningSent)
      ) {
        const hourlyKey = `${nowDate}T${String(nowHour).padStart(2, '0')}`;
        if (!(state.hourly ?? []).includes(hourlyKey)) {
          actions.push({ type: 'hourly', hourlyKey });
        }
      }
    }

    for (const stage of MINUTE_STAGES) {
      const tol = stage.tolerance * MS_MINUTE;
      const target = stage.minutes * MS_MINUTE;
      if (
        !sentAt(state, stage.type) &&
        msToStart >= target - tol &&
        msToStart <= target + tol
      ) {
        actions.push({ type: stage.type });
      }
    }

    return actions;
  }

  if (!windowEnd || now <= windowEnd) return actions;

  for (const slot of PAST_DUE_SLOTS) {
    if (!sentToday(state, slot.type, now) && nowHour >= config[slot.hourKey]) {
      return [
        {
          type: slot.type,
          ...(slot.incrementDay ? { incrementPastDueDay: true } : {}),
        },
      ];
    }
  }

  return actions;
}

export function buildReturnRequestReminderConfigFromEnv(): ReturnRequestReminderConfig {
  const n = (key: string, fallback: number) => Number(process.env[key] ?? fallback);
  return {
    preWindowMorningHour: n('RETURN_REQUEST_REMINDER_MORNING_HOUR', 8),
    pastDueMorningHour: n('RETURN_REQUEST_PAST_DUE_MORNING_HOUR', 8),
    pastDueAfternoonHour: n('RETURN_REQUEST_PAST_DUE_AFTERNOON_HOUR', 14),
    pastDueEveningHour: n('RETURN_REQUEST_PAST_DUE_EVENING_HOUR', 20),
  };
}

export function returnRequestReminderNotificationCopy(
  type: ReturnRequestReminderType,
  orderId: string,
  productName: string,
  daysPastDue: number,
): { title: string; message: string } {
  const item = `${orderId} (${productName})`;
  const copies: Record<ReturnRequestReminderType, { title: string; message: string }> = {
    '24_hours_before': {
      title: 'Complete your return request',
      message: `Pickup for order ${item} is within 24 hours, but no rider will be sent until you complete your return request in the app.`,
    },
    morning_of: {
      title: 'Complete your return request today',
      message: `Pickup for order ${item} is scheduled for today. Complete your return request now or the carrier cannot be booked.`,
    },
    hourly: {
      title: 'Complete your return request soon',
      message: `Pickup for order ${item} is approaching. Submit your return request in the app now so we can book the rider.`,
    },
    '30_minutes': {
      title: 'Urgent: complete your return request',
      message: `Pickup for order ${item} is in about 30 minutes. Complete your return request immediately or pickup will not be booked.`,
    },
    '15_minutes': {
      title: 'Urgent: complete your return request now',
      message: `Pickup for order ${item} is in about 15 minutes. Complete your return request right now.`,
    },
    '5_minutes': {
      title: 'Final warning: complete your return request',
      message: `Pickup for order ${item} is in about 5 minutes. Complete your return request immediately or pickup cannot go ahead.`,
    },
    past_due_morning: {
      title: 'Overdue: complete your return request',
      message: `Your return request for order ${item} is still incomplete (day ${daysPastDue}). Submit it today to schedule pickup.`,
    },
    past_due_afternoon: {
      title: 'Still overdue: complete your return request',
      message: `Your return request for order ${item} is still not submitted. Complete it in the app as soon as possible.`,
    },
    past_due_evening: {
      title: 'Last chance tonight: complete your return request',
      message: `Final reminder today for order ${item}: your return request is still incomplete. Submit it tonight.`,
    },
  };
  return copies[type];
}

export function returnRequestReminderEmailCopy(
  type: ReturnRequestReminderType,
  productName: string,
  windowLabel: string | undefined,
  daysPastDue: number | undefined,
  collateralAtRisk: number | undefined,
  penaltyPercent: number,
): { subject: string; heading: string; body: string; footer: string } {
  const w = windowLabel ? ` Planned pickup window: ${windowLabel}.` : '';
  const day = daysPastDue && daysPastDue > 0 ? ` (day ${daysPastDue})` : '';
  const penalty =
    collateralAtRisk && type === 'past_due_morning'
      ? ` Late returns may incur a ${penaltyPercent}% daily collateral penalty.`
      : '';
  const noPickup =
    'No rider will be sent and pickup cannot be booked until you submit your return request in the app.';

  const copies: Record<
    ReturnRequestReminderType,
    { subject: string; heading: string; body: string; footer: string }
  > = {
    '24_hours_before': {
      subject: 'Action required: complete your return request',
      heading: 'Complete your return request',
      body: `Your pickup for <strong>${productName}</strong> is within 24 hours.${w} ${noPickup}`,
      footer: '',
    },
    morning_of: {
      subject: 'Today: complete your return request to book pickup',
      heading: 'Complete your return request today',
      body: `Pickup for <strong>${productName}</strong> is scheduled for today.${w} ${noPickup}`,
      footer: '',
    },
    hourly: {
      subject: 'Reminder: complete your return request before pickup',
      heading: 'Submit your return request now',
      body: `Pickup for <strong>${productName}</strong> is coming up soon.${w} ${noPickup}`,
      footer: '',
    },
    '30_minutes': {
      subject: 'Urgent: complete your return request (30 minutes left)',
      heading: '30 minutes to submit your return request',
      body: `Pickup for <strong>${productName}</strong> is in about 30 minutes.${w} ${noPickup}`,
      footer: 'Open your order and tap Start Return Process now.',
    },
    '15_minutes': {
      subject: 'Urgent: complete your return request now (15 minutes left)',
      heading: '15 minutes to submit your return request',
      body: `Pickup for <strong>${productName}</strong> is in about 15 minutes.${w} ${noPickup}`,
      footer: 'Open your order and tap Start Return Process now.',
    },
    '5_minutes': {
      subject: 'Final warning: complete your return request (5 minutes left)',
      heading: '5 minutes to submit your return request',
      body: `Pickup for <strong>${productName}</strong> is in about 5 minutes.${w} ${noPickup}`,
      footer: 'Without a submitted return request, pickup will not be booked.',
    },
    past_due_morning: {
      subject: `Overdue${day}: complete your return request`,
      heading: 'Your return request is overdue',
      body: `You have not completed your return request for <strong>${productName}</strong>${day}. Submit it today so we can schedule pickup.${penalty}`,
      footer: 'Please act today to avoid further penalties.',
    },
    past_due_afternoon: {
      subject: 'Action required: your return request is still incomplete',
      heading: 'Return request still not submitted',
      body: `Your return request for <strong>${productName}</strong> is still incomplete${day}. Complete it in the app now.${w}`,
      footer: 'Late returns may incur collateral penalties.',
    },
    past_due_evening: {
      subject: 'Last chance tonight: complete your return request',
      heading: 'Submit your return request tonight',
      body: `Final reminder for today: your return request for <strong>${productName}</strong> is still not submitted${day}. Complete it tonight.`,
      footer: 'Another penalty day may apply if your return request is still incomplete tomorrow.',
    },
  };
  return copies[type];
}

/** No-op until LATE_RETURN_COLLATERAL_PENALTY_ENABLED=true and business flow is finalized. */
export async function applyLateReturnCollateralPenaltyIfEnabled(
  _prisma: PrismaService,
  input: { collateralAmount: number },
): Promise<void> {
  if (process.env.LATE_RETURN_COLLATERAL_PENALTY_ENABLED !== 'true') return;
  const percent = Number(process.env.LATE_RETURN_COLLATERAL_PENALTY_PERCENT ?? 5);
  const _amount = Math.round((input.collateralAmount * percent) / 100);
  // Wallet debit/credit transaction block goes here when approved.
}
