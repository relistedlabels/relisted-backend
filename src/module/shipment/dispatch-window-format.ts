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
