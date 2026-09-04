export const LAGOS_TIME_ZONE = 'Africa/Lagos';

const LAGOS_ISO_OFFSET = '+01:00';

const lagosDateOpts: Intl.DateTimeFormatOptions = {
  timeZone: LAGOS_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};

const lagosTimeOpts: Intl.DateTimeFormatOptions = {
  timeZone: LAGOS_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

/** Lagos-local summary for renter-facing pickup/dispatch windows. */
export function formatDispatchWindowLagos(start: Date, end: Date): string {
  return `${start.toLocaleDateString('en-NG', lagosDateOpts)}, ${start.toLocaleTimeString('en-NG', lagosTimeOpts)} to ${end.toLocaleTimeString('en-NG', lagosTimeOpts)}`;
}

/** Single instant for emails and notifications (always Africa/Lagos, not server local). */
export function formatDateTimeLagos(input: string | Date): string {
  const date = coerceLagosDate(input);
  if (!date) return '';
  return date.toLocaleString('en-NG', {
    timeZone: LAGOS_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Calendar day label for rental boundaries and delivery estimates. */
export function formatRentalBoundaryDateLagos(input: string | Date): string {
  const date = coerceLagosDate(input);
  if (!date) return '';
  return date.toLocaleDateString('en-NG', {
    timeZone: LAGOS_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function coerceLagosDate(input: string | Date): Date | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00${LAGOS_ISO_OFFSET}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function lagosCalendarKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: LAGOS_TIME_ZONE });
}

/** 1 → 1st, 2 → 2nd, 3 → 3rd, 11 → 11th, etc. */
export function formatOrdinalDay(day: number): string {
  const n = Math.abs(Math.trunc(day));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function lagosDayMonth(d: Date): { day: number; month: string; dayLabel: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS_TIME_ZONE,
    day: 'numeric',
    month: 'long',
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return { day, month, dayLabel: formatOrdinalDay(day) };
}


/** Compact time for emails, e.g. 10 am or 2:30 pm */
export function formatEmailTimeCompact(input: string | Date): string {
  const date = coerceLagosDate(input);
  if (!date) return '';
  const raw = date.toLocaleTimeString('en-GB', {
    timeZone: LAGOS_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return raw.replace(':00', '').trim().toLowerCase();
}

/** Compact rental range for emails, e.g. 10th–13th June */
export function formatRentalPeriodCompact(
  start: string | Date,
  end: string | Date,
): string {
  const s = coerceLagosDate(start);
  const e = coerceLagosDate(end);
  if (!s || !e) return '';
  if (lagosCalendarKey(s) === lagosCalendarKey(e)) {
    const one = lagosDayMonth(s);
    return `${one.dayLabel} ${one.month}`;
  }
  const sp = lagosDayMonth(s);
  const ep = lagosDayMonth(e);
  if (sp.month === ep.month) {
    return `${sp.dayLabel}–${ep.dayLabel} ${sp.month}`;
  }
  return `${sp.dayLabel} ${sp.month} – ${ep.dayLabel} ${ep.month}`;
}

/** Compact dispatch window for emails, e.g. 10th June, 10 am – 2 pm WAT */
export function formatDispatchWindowCompact(
  start: string | Date,
  end: string | Date,
): string {
  const s = coerceLagosDate(start);
  const e = coerceLagosDate(end);
  if (!s || !e) return '';
  const startTime = formatEmailTimeCompact(s);
  const endTime = formatEmailTimeCompact(e);
  if (lagosCalendarKey(s) === lagosCalendarKey(e)) {
    const { dayLabel, month } = lagosDayMonth(s);
    return `${dayLabel} ${month}, ${startTime} – ${endTime} WAT`;
  }
  const sp = lagosDayMonth(s);
  const ep = lagosDayMonth(e);
  return `${sp.dayLabel} ${sp.month} ${startTime} – ${ep.dayLabel} ${ep.month} ${endTime} WAT`;
}
