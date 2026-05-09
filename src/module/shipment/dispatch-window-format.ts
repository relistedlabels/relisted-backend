/** Lagos-local summary for renter-facing pickup/dispatch windows. */
export function formatDispatchWindowLagos(start: Date, end: Date): string {
  const tz = 'Africa/Lagos';
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
