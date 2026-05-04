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

export const DEFAULT_DISPATCH_WINDOW_HOURS = Number(
  process.env.DEFAULT_DISPATCH_WINDOW_HOURS ?? 2,
);
export const MIN_DISPATCH_WINDOW_MINUTES = Number(
  process.env.MIN_DISPATCH_WINDOW_MINUTES ?? 60,
);
export const MAX_DISPATCH_WINDOW_MINUTES = Number(
  process.env.MAX_DISPATCH_WINDOW_MINUTES ?? 240,
);
export const DISPATCH_WINDOW_START_HOUR = Number(
  process.env.DISPATCH_WINDOW_START_HOUR ?? 8,
);
export const DISPATCH_WINDOW_END_HOUR = Number(
  process.env.DISPATCH_WINDOW_END_HOUR ?? 14,
);

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
  // Calculate bounds in UTC for Africa/Lagos timezone (UTC+1)
  // Get the date in Lagos timezone and convert to UTC
  const lagosOffset = 1 * 60 * 60 * 1000; // 1 hour in ms for WAT
  const utcDate = new Date(date.getTime() - lagosOffset);
  const dayStart = startOfDay(utcDate);
  // Add back the offset to get Lagos time in UTC
  const lagosDayStart = new Date(dayStart.getTime() + lagosOffset);
  const start = addHours(lagosDayStart, DISPATCH_WINDOW_START_HOUR);
  const end = addHours(lagosDayStart, DISPATCH_WINDOW_END_HOUR);

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

  let end = new Date(
    Math.min(
      bounds.end.getTime(),
      start.getTime() + DEFAULT_DISPATCH_WINDOW_HOURS * 60 * 60 * 1000,
    ),
  );

  if (differenceInMinutes(end, start) < MIN_DISPATCH_WINDOW_MINUTES) {
    reference = addDays(startOfDay(start), 1);
    bounds = getDailyWindowBounds(reference);
    start.setTime(bounds.start.getTime());
    end = new Date(
      Math.min(
        bounds.end.getTime(),
        start.getTime() + DEFAULT_DISPATCH_WINDOW_HOURS * 60 * 60 * 1000,
      ),
    );
  }

  return { start, end };
}

export function parseDispatchWindowFromInput(
  type: DispatchWindowType,
  manual: DispatchWindowInput,
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

  const bounds = getDailyWindowBounds(start);
  if (start < bounds.start || end > bounds.end) {
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
  if (end <= now) {
    bad(`${type} dispatch window has already passed.`);
  }

  return { start, end };
}

export function isWindowExpired(
  window: DispatchWindowRange | undefined,
  now = new Date(),
) {
  if (!window) return true;
  return window.end.getTime() <= now.getTime();
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
