import { InternalServerErrorException } from '@nestjs/common';
import {
  addDays,
  addHours,
  differenceInMinutes,
  isAfter,
  isSameDay,
  isValid,
  parseISO,
  startOfDay,
} from 'date-fns';
import { bad } from './error';

export const MIN_DISPATCH_WINDOW_MINUTES = Number(
  process.env.MIN_DISPATCH_WINDOW_MINUTES ?? 60,
);
function resolveDefaultDispatchWindowMinutes(): number {
  const fromMinutes = process.env.DEFAULT_DISPATCH_WINDOW_MINUTES;
  if (fromMinutes != null && fromMinutes !== '') {
    return Number(fromMinutes);
  }
  const fromHours = process.env.DEFAULT_DISPATCH_WINDOW_HOURS;
  if (fromHours != null && fromHours !== '') {
    return Number(fromHours) * 60;
  }
  return MIN_DISPATCH_WINDOW_MINUTES;
}

/** Default slot length for server-built windows; matches frontend 60-minute dispatch slots. */
export const DEFAULT_DISPATCH_WINDOW_MINUTES =
  resolveDefaultDispatchWindowMinutes();
/** @deprecated Prefer DEFAULT_DISPATCH_WINDOW_MINUTES / MIN_DISPATCH_WINDOW_MINUTES */
export const DEFAULT_DISPATCH_WINDOW_HOURS =
  DEFAULT_DISPATCH_WINDOW_MINUTES / 60;
export const MAX_DISPATCH_WINDOW_MINUTES = Number(
  process.env.MAX_DISPATCH_WINDOW_MINUTES ?? 240,
);
export const DISPATCH_WINDOW_START_HOUR = Number(
  process.env.DISPATCH_WINDOW_START_HOUR ?? 8,
);
export const DISPATCH_WINDOW_END_HOUR = Number(
  process.env.DISPATCH_WINDOW_END_HOUR ?? 14,
);
/** Renter return pickup slots (UI + booking); defaults to 8am–5pm Lagos. */
export const RETURN_DISPATCH_WINDOW_START_HOUR = Number(
  process.env.RETURN_DISPATCH_WINDOW_START_HOUR ??
    process.env.DISPATCH_WINDOW_START_HOUR ??
    8,
);
export const RETURN_DISPATCH_WINDOW_END_HOUR = Number(
  process.env.RETURN_DISPATCH_WINDOW_END_HOUR ?? 17,
);

const LAGOS_TZ = 'Africa/Lagos';
const LAGOS_ISO_OFFSET = '+01:00';

export type DispatchWindowType = 'OUTBOUND' | 'RETURN' | 'RESALE';

export type DispatchWindowInput = {
  start: string;
  end: string;
};

export type DispatchWindowsInput = Partial<
  Record<DispatchWindowType, DispatchWindowInput>
>;

export type DispatchWindowRange = {
  start: Date;
  end: Date;
};

export type DispatchWindowRangeMap = Partial<
  Record<DispatchWindowType, DispatchWindowRange>
>;

export type DispatchWindowFieldMap = Record<
  DispatchWindowType,
  { start: string; end: string }
>;

export const availabilityRequestWindowFieldMap: DispatchWindowFieldMap = {
  OUTBOUND: { start: 'outboundWindowStart', end: 'outboundWindowEnd' },
  RETURN: { start: 'returnWindowStart', end: 'returnWindowEnd' },
  RESALE: { start: 'resaleWindowStart', end: 'resaleWindowEnd' },
};

export const returnRequestWindowFieldMap: DispatchWindowFieldMap = {
  OUTBOUND: { start: 'pickupWindowStart', end: 'pickupWindowEnd' },
  RETURN: { start: 'pickupWindowStart', end: 'pickupWindowEnd' },
  RESALE: { start: 'pickupWindowStart', end: 'pickupWindowEnd' },
};

export function getDailyWindowBounds(date: Date) {
  // Get the date in Lagos timezone to determine the day
  const lagosDay = new Date(date.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  const dayStart = startOfDay(lagosDay);
  const start = addHours(dayStart, DISPATCH_WINDOW_START_HOUR);
  const end = addHours(dayStart, DISPATCH_WINDOW_END_HOUR);

  if (!isAfter(end, start)) {
    throw new InternalServerErrorException(
      'DISPATCH_WINDOW_END_HOUR must be greater than DISPATCH_WINDOW_START_HOUR',
    );
  }

  if (differenceInMinutes(end, start) < MIN_DISPATCH_WINDOW_MINUTES) {
    throw new InternalServerErrorException(
      'Configured dispatch window span is shorter than the enforced minimum duration.',
    );
  }

  return { start, end } as const;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildLagosDateFromCalendarKey(
  ymd: string,
  minutesFromMidnight: number,
): Date {
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  return new Date(
    `${ymd}T${pad2(hours)}:${pad2(minutes)}:00${LAGOS_ISO_OFFSET}`,
  );
}

function getReturnDailyWindowBounds(date: Date) {
  const lagosDay = new Date(date.toLocaleString('en-US', { timeZone: LAGOS_TZ }));
  const dayStart = startOfDay(lagosDay);
  const start = addHours(dayStart, RETURN_DISPATCH_WINDOW_START_HOUR);
  const end = addHours(dayStart, RETURN_DISPATCH_WINDOW_END_HOUR);

  if (!isAfter(end, start)) {
    throw new InternalServerErrorException(
      'RETURN_DISPATCH_WINDOW_END_HOUR must be greater than RETURN_DISPATCH_WINDOW_START_HOUR',
    );
  }

  if (differenceInMinutes(end, start) < MIN_DISPATCH_WINDOW_MINUTES) {
    throw new InternalServerErrorException(
      'Return dispatch window span is shorter than the enforced minimum duration.',
    );
  }

  return { start, end } as const;
}

export function buildDefaultReturnDispatchWindow(
  baseDate: Date,
): DispatchWindowRange {
  let reference = new Date(baseDate);
  let bounds = getReturnDailyWindowBounds(reference);

  if (reference >= bounds.end) {
    reference = addDays(startOfDay(reference), 1);
    bounds = getReturnDailyWindowBounds(reference);
  }

  const lagosMinutes = getLagosMinutesFromMidnight(reference);
  const roundedMinutes =
    lagosMinutes % 60 >= 30
      ? lagosMinutes + (60 - (lagosMinutes % 60))
      : lagosMinutes - (lagosMinutes % 60);
  const dayKey = getLagosCalendarDateKey(reference);
  let start = buildLagosDateFromCalendarKey(dayKey, roundedMinutes);

  if (start < bounds.start) {
    start = new Date(bounds.start);
  }
  if (start >= bounds.end) {
    reference = addDays(startOfDay(reference), 1);
    bounds = getReturnDailyWindowBounds(reference);
    start = new Date(bounds.start);
  }

  const defaultDurationMs = DEFAULT_DISPATCH_WINDOW_MINUTES * 60 * 1000;
  let end = new Date(
    Math.min(bounds.end.getTime(), start.getTime() + defaultDurationMs),
  );

  if (differenceInMinutes(end, start) < MIN_DISPATCH_WINDOW_MINUTES) {
    reference = addDays(startOfDay(start), 1);
    bounds = getReturnDailyWindowBounds(reference);
    start = new Date(bounds.start);
    end = new Date(
      Math.min(bounds.end.getTime(), start.getTime() + defaultDurationMs),
    );
  }

  return { start, end };
}

export function buildDefaultDispatchWindow(baseDate: Date): DispatchWindowRange {
  let reference = new Date(baseDate);
  let bounds = getDailyWindowBounds(reference);

  if (reference >= bounds.end) {
    reference = addDays(startOfDay(reference), 1);
    bounds = getDailyWindowBounds(reference);
  }

  // Round to nearest hour: if minutes >= 30, round up; else round down
  const minutes = reference.getMinutes();
  const roundedHour = minutes >= 30 ? addHours(reference, 1) : reference;
  const start = new Date(roundedHour);
  start.setMinutes(0, 0, 0);

  // Ensure start is within operating hours
  if (start < bounds.start) {
    start.setTime(bounds.start.getTime());
  }
  if (start >= bounds.end) {
    reference = addDays(startOfDay(start), 1);
    bounds = getDailyWindowBounds(reference);
    start.setTime(bounds.start.getTime());
  }

  const defaultDurationMs = DEFAULT_DISPATCH_WINDOW_MINUTES * 60 * 1000;

  let end = new Date(
    Math.min(bounds.end.getTime(), start.getTime() + defaultDurationMs),
  );

  if (differenceInMinutes(end, start) < MIN_DISPATCH_WINDOW_MINUTES) {
    reference = addDays(startOfDay(start), 1);
    bounds = getDailyWindowBounds(reference);
    start.setTime(bounds.start.getTime());
    end = new Date(
      Math.min(bounds.end.getTime(), start.getTime() + defaultDurationMs),
    );
  }

  return { start, end };
}

export type ParseDispatchWindowOptions = {
  /** When true, do not reject windows whose end time is already in the past. */
  allowPast?: boolean;
};

export function parseDispatchWindowFromInput(
  type: DispatchWindowType,
  manual: DispatchWindowInput,
  options?: ParseDispatchWindowOptions,
): DispatchWindowRange {
  // Parse ISO strings with timezone offset to get correct UTC time
  const start = new Date(manual.start);
  const end = new Date(manual.end);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    bad(`${type} dispatch window timestamps must be valid ISO-8601 strings.`);
  }

  // Check same day in Africa/Lagos timezone
  const startLagos = start.toLocaleDateString('en-US', { timeZone: 'Africa/Lagos' });
  const endLagos = end.toLocaleDateString('en-US', { timeZone: 'Africa/Lagos' });
  if (startLagos !== endLagos) {
    bad(`${type} dispatch window must start and end on the same day.`);
  }

  const dayStartMinutes = DISPATCH_WINDOW_START_HOUR * 60;
  const dayEndMinutes = DISPATCH_WINDOW_END_HOUR * 60;
  const startMinutes = getLagosMinutesFromMidnight(start);
  const endMinutes = getLagosMinutesFromMidnight(end);

  if (startMinutes < dayStartMinutes || endMinutes > dayEndMinutes) {
    bad(
      `${type} dispatch window must fall between ${DISPATCH_WINDOW_START_HOUR}:00 and ${DISPATCH_WINDOW_END_HOUR}:00 local time.`,
    );
  }

  if (!isAfter(end, start)) {
    bad(`${type} dispatch window end must be after the start time.`);
  }

  const durationMinutes = differenceInMinutes(end, start);
  if (durationMinutes < MIN_DISPATCH_WINDOW_MINUTES) {
    bad(
      `${type} dispatch window must be at least ${MIN_DISPATCH_WINDOW_MINUTES} minute(s).`,
    );
  }
  if (durationMinutes > MAX_DISPATCH_WINDOW_MINUTES) {
    bad(
      `${type} dispatch window cannot exceed ${MAX_DISPATCH_WINDOW_MINUTES} minute(s).`,
    );
  }

  const now = new Date();
  if (!options?.allowPast && end <= now) {
    bad(`${type} dispatch window has already passed.`);
  }

  return { start, end };
}

export type ResolveNextReturnWindowResult = {
  window: DispatchWindowRange;
  rescheduled: boolean;
  originalWindow?: DispatchWindowRange;
};

/**
 * Resolve a return pickup window. When the preferred window has passed, roll
 * forward to the next available slot within daily dispatch bounds (8am–end hour).
 */
export function resolveNextReturnPickupWindow(
  reference = new Date(),
  preferred?: DispatchWindowInput | DispatchWindowRange | null,
): ResolveNextReturnWindowResult {
  let candidate: DispatchWindowRange | null = null;

  if (preferred) {
    if (preferred.start instanceof Date && preferred.end instanceof Date) {
      candidate = { start: preferred.start, end: preferred.end };
    } else {
      try {
        candidate = parseDispatchWindowFromInput(
          'RETURN',
          preferred as DispatchWindowInput,
          { allowPast: true },
        );
      } catch {
        candidate = null;
      }
    }
  }

  if (candidate && !isWindowExpired(candidate, reference)) {
    return { window: candidate, rescheduled: false };
  }

  return {
    window: buildDefaultReturnDispatchWindow(reference),
    rescheduled: Boolean(candidate),
    originalWindow: candidate ?? undefined,
  };
}

export type ReturnPickupWindowOptionDto = {
  start: string;
  end: string;
  summary: string;
};

export type ReturnPickupWindowOptionsResult = {
  scheduledDay: string;
  scheduledDayLabel: string;
  originalWindow: (ReturnPickupWindowOptionDto & { expired: boolean }) | null;
  rescheduled: boolean;
  suggested: ReturnPickupWindowOptionDto;
  sameDayOptions: ReturnPickupWindowOptionDto[];
};

function formatReturnWindowSummaryLagos(start: Date, end: Date): string {
  const tz = LAGOS_TZ;
  const dateOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return `${start.toLocaleDateString('en-NG', dateOpts)}, ${start.toLocaleTimeString('en-NG', timeOpts)} to ${end.toLocaleTimeString('en-NG', timeOpts)}`;
}

function returnWindowOptionFromRange(range: DispatchWindowRange): ReturnPickupWindowOptionDto {
  return {
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    summary: formatReturnWindowSummaryLagos(range.start, range.end),
  };
}

/** Hourly return pickup slots on one Lagos calendar day (8am–5pm, 60-minute windows). */
export function listReturnPickupSlotsForDay(
  scheduledDay: string,
  now = new Date(),
): DispatchWindowRange[] {
  const dayStartMinutes = RETURN_DISPATCH_WINDOW_START_HOUR * 60;
  const dayEndMinutes = RETURN_DISPATCH_WINDOW_END_HOUR * 60;
  const duration = DEFAULT_DISPATCH_WINDOW_MINUTES;
  const lastStart = dayEndMinutes - duration;
  const slots: DispatchWindowRange[] = [];

  for (let startMin = dayStartMinutes; startMin <= lastStart; startMin += 60) {
    const start = buildLagosDateFromCalendarKey(scheduledDay, startMin);
    const end = buildLagosDateFromCalendarKey(scheduledDay, startMin + duration);
    if (end.getTime() <= now.getTime()) {
      continue;
    }
    slots.push({ start, end });
  }

  return slots;
}

export function buildReturnPickupWindowOptions(
  reference = new Date(),
  preferred?: DispatchWindowInput | DispatchWindowRange | null,
): ReturnPickupWindowOptionsResult {
  const resolved = resolveNextReturnPickupWindow(reference, preferred);
  const scheduledDay = getLagosCalendarDateKey(resolved.window.start);
  const scheduledDayLabel = new Date(resolved.window.start).toLocaleDateString(
    'en-NG',
    {
      timeZone: LAGOS_TZ,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    },
  );

  let originalWindow: (ReturnPickupWindowOptionDto & { expired: boolean }) | null =
    null;
  if (preferred) {
    let candidate: DispatchWindowRange | null = null;
    if (preferred.start instanceof Date && preferred.end instanceof Date) {
      candidate = { start: preferred.start, end: preferred.end };
    }
    if (candidate) {
      originalWindow = {
        ...returnWindowOptionFromRange(candidate),
        expired: isWindowExpired(candidate, reference),
      };
    }
  }

  const sameDaySlots = listReturnPickupSlotsForDay(scheduledDay, reference);
  const suggestedOption = returnWindowOptionFromRange(resolved.window);
  const sameDayOptions =
    sameDaySlots.length > 0
      ? sameDaySlots.map(returnWindowOptionFromRange)
      : [suggestedOption];

  return {
    scheduledDay,
    scheduledDayLabel,
    originalWindow,
    rescheduled: resolved.rescheduled,
    suggested: suggestedOption,
    sameDayOptions,
  };
}

/** Validate renter-selected return window: same scheduled day, 8am–5pm, future, known slot. */
export function parseReturnPickupWindowChoice(
  choice: DispatchWindowInput,
  scheduledDay: string,
  reference = new Date(),
): DispatchWindowRange {
  const start = new Date(choice.start);
  const end = new Date(choice.end);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    bad('Return pickup window timestamps must be valid ISO-8601 strings.');
  }

  const startDay = getLagosCalendarDateKey(start);
  const endDay = getLagosCalendarDateKey(end);
  if (startDay !== scheduledDay || endDay !== scheduledDay) {
    bad('Return pickup must stay on the scheduled return day.');
  }

  const dayStartMinutes = RETURN_DISPATCH_WINDOW_START_HOUR * 60;
  const dayEndMinutes = RETURN_DISPATCH_WINDOW_END_HOUR * 60;
  const startMinutes = getLagosMinutesFromMidnight(start);
  const endMinutes = getLagosMinutesFromMidnight(end);

  if (startMinutes < dayStartMinutes || endMinutes > dayEndMinutes) {
    bad(
      `Return pickup must fall between ${RETURN_DISPATCH_WINDOW_START_HOUR}:00 and ${RETURN_DISPATCH_WINDOW_END_HOUR}:00 local time.`,
    );
  }

  if (!isAfter(end, start)) {
    bad('Return pickup window end must be after the start time.');
  }

  const durationMinutes = differenceInMinutes(end, start);
  if (durationMinutes < MIN_DISPATCH_WINDOW_MINUTES) {
    bad(
      `Return pickup window must be at least ${MIN_DISPATCH_WINDOW_MINUTES} minute(s).`,
    );
  }
  if (durationMinutes > MAX_DISPATCH_WINDOW_MINUTES) {
    bad(
      `Return pickup window cannot exceed ${MAX_DISPATCH_WINDOW_MINUTES} minute(s).`,
    );
  }

  if (end <= reference) {
    bad('Return pickup window has already passed.');
  }

  const allowed = listReturnPickupSlotsForDay(scheduledDay, reference);
  const match = allowed.find(
    (slot) =>
      slot.start.getTime() === start.getTime() &&
      slot.end.getTime() === end.getTime(),
  );
  if (!match) {
    bad('Selected return pickup window is not available.');
  }

  return match;
}

export function resolveReturnPickupWindowForSubmit(
  reference = new Date(),
  preferred?: DispatchWindowInput | DispatchWindowRange | null,
  choice?: DispatchWindowInput | null,
): { window: DispatchWindowRange; rescheduled: boolean; scheduledDay: string } {
  const options = buildReturnPickupWindowOptions(reference, preferred);

  if (choice?.start && choice?.end) {
    try {
      const window = parseReturnPickupWindowChoice(
        choice,
        options.scheduledDay,
        reference,
      );
      const originalExpired = options.originalWindow?.expired ?? false;
      const keptOriginal =
        !originalExpired &&
        options.originalWindow &&
        new Date(options.originalWindow.start).getTime() ===
          window.start.getTime();
      return {
        window,
        rescheduled: originalExpired || !keptOriginal,
        scheduledDay: options.scheduledDay,
      };
    } catch {
      // Stale client selection (e.g. checkout slot that already started) — next slot.
    }
  }

  return {
    window: {
      start: new Date(options.suggested.start),
      end: new Date(options.suggested.end),
    },
    rescheduled: options.rescheduled,
    scheduledDay: options.scheduledDay,
  };
}

export function isWindowExpired(
  window: DispatchWindowRange | undefined,
  now = new Date(),
) {
  if (!window) return true;
  return window.end.getTime() <= now.getTime();
}

/** Calendar day (YYYY-MM-DD) for `date` in Africa/Lagos. */
export function getLagosCalendarDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

/** Return pickup day: calendar day after the last wear day (`start + days`). */
export function rentalReturnPickupDate(rentalStart: Date, days: number): Date {
  return addDays(rentalStart, days > 0 ? days : 1);
}

/** Lagos midnight for a YYYY-MM-DD calendar key. */
export function lagosMidnightFromCalendarKey(ymd: string): Date {
  return new Date(`${ymd}T00:00:00${LAGOS_ISO_OFFSET}`);
}

export function resolveRentalDispatchWindowBases(input: {
  startDate: Date | null;
  endDate: Date | null;
  rentalDays: number;
  now?: Date;
}): { outbound: Date; returnLeg: Date; resale: Date } {
  const now = input.now ?? new Date();
  const start = input.startDate;
  const outbound =
    start && start.getTime() > now.getTime() ? start : now;

  let returnLeg = now;
  if (start && input.rentalDays > 0) {
    const pickup = rentalReturnPickupDate(start, input.rentalDays);
    returnLeg = pickup.getTime() > now.getTime() ? pickup : now;
  } else if (input.endDate) {
    const pickup = addDays(input.endDate, 1);
    returnLeg = pickup.getTime() > now.getTime() ? pickup : now;
  }

  return { outbound, returnLeg, resale: now };
}

export function returnDispatchWindowMatchesPickupDay(
  window: DispatchWindowRange | undefined,
  pickupDate: Date,
): boolean {
  if (!window) return false;
  return (
    getLagosCalendarDateKey(window.start) === getLagosCalendarDateKey(pickupDate)
  );
}

/** Rebuild RETURN when it is not scheduled on the rental pickup day (`start + days`). */
export function ensureRentalReturnDispatchWindow(
  map: DispatchWindowRangeMap,
  rentalContext: { startDate: Date | null; rentalDays: number },
  now?: Date,
): DispatchWindowRangeMap {
  const { startDate, rentalDays } = rentalContext;
  if (rentalDays <= 0 || !startDate || !map.RETURN) {
    return map;
  }
  const pickup = rentalReturnPickupDate(startDate, rentalDays);
  if (returnDispatchWindowMatchesPickupDay(map.RETURN, pickup)) {
    return map;
  }
  const bases = resolveRentalDispatchWindowBases({
    startDate,
    endDate: null,
    rentalDays,
    now,
  });
  return {
    ...map,
    RETURN: buildDefaultDispatchWindow(bases.returnLeg),
  };
}

function getLagosMinutesFromMidnight(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number.parseInt(
    parts.find((p) => p.type === 'hour')?.value ?? '0',
    10,
  );
  const minute = Number.parseInt(
    parts.find((p) => p.type === 'minute')?.value ?? '0',
    10,
  );
  return hour * 60 + minute;
}

/**
 * Widest window covering all inputs (earliest start, latest end).
 * Used when multiple resale lines from one lister share a delivery day.
 */
export function mergeDispatchWindowRanges(
  windows: DispatchWindowRange[],
): DispatchWindowRange {
  if (windows.length === 0) {
    throw new InternalServerErrorException(
      'mergeDispatchWindowRanges requires at least one window',
    );
  }
  if (windows.length === 1) return windows[0];

  let start = windows[0].start;
  let end = windows[0].end;
  for (let i = 1; i < windows.length; i++) {
    const w = windows[i];
    if (w.start.getTime() < start.getTime()) start = w.start;
    if (w.end.getTime() > end.getTime()) end = w.end;
  }
  return { start, end };
}

export function extractRangeMapFromEntity(
  entity: Record<string, any>,
  fieldMap: DispatchWindowFieldMap,
): DispatchWindowRangeMap {
  const map: DispatchWindowRangeMap = {};
  for (const type of Object.keys(fieldMap) as DispatchWindowType[]) {
    const { start, end } = fieldMap[type];
    const startValue = entity?.[start];
    const endValue = entity?.[end];
    if (startValue && endValue) {
      map[type] = {
        start: new Date(startValue),
        end: new Date(endValue),
      };
    }
  }
  return map;
}

export function applyRangeMapToData(
  map: DispatchWindowRangeMap,
  fieldMap: DispatchWindowFieldMap,
) {
  const data: Record<string, Date | null> = {};
  for (const type of Object.keys(fieldMap) as DispatchWindowType[]) {
    const { start, end } = fieldMap[type];
    data[start] = map[type]?.start ?? null;
    data[end] = map[type]?.end ?? null;
  }
  return data;
}
