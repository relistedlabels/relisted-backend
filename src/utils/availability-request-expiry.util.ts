import { addDays } from 'date-fns';
import {
  applyRangeMapToData,
  availabilityRequestWindowFieldMap,
  buildDefaultDispatchWindow,
  DispatchWindowRangeMap,
  DispatchWindowType,
  ensureRentalReturnDispatchWindow,
  extractRangeMapFromEntity,
  getLagosCalendarDateKey,
  isWindowExpired,
  lagosMidnightFromCalendarKey,
  resolveRentalDispatchWindowBases,
} from './dispatch-windows';

/** Lister should respond within this window; request stays approvable after until business expiry. */
export const AVAILABILITY_RESPONSE_SLA_MINUTES = 15;

/** Purchase requests without a resale dispatch window stay open this long from creation. */
export const PURCHASE_BUSINESS_VALIDITY_DAYS = 7;

export type AvailabilityRequestExpiryFields = {
  rentalDays: number | null;
  startDate: Date | null;
  resaleWindowEnd: Date | null;
  createdAt: Date;
};

export type AvailabilityRequestActionFields = AvailabilityRequestExpiryFields & {
  status: string;
  expiresAt: Date;
  endDate?: Date | null;
};

/** Hard cutoff: rental start day (Lagos) or purchase resale window / creation + 7 days. */
export function computeBusinessExpiresAt(
  request: AvailabilityRequestExpiryFields,
): Date {
  const isPurchase = (request.rentalDays ?? 0) === 0;

  if (!isPurchase && request.startDate) {
    const dayKey = getLagosCalendarDateKey(request.startDate);
    const dayStart = lagosMidnightFromCalendarKey(dayKey);
    return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  if (isPurchase && request.resaleWindowEnd) {
    return request.resaleWindowEnd;
  }

  return addDays(request.createdAt, PURCHASE_BUSINESS_VALIDITY_DAYS);
}

export function isBusinessExpired(
  request: AvailabilityRequestExpiryFields,
  now = new Date(),
): boolean {
  return now.getTime() > computeBusinessExpiresAt(request).getTime();
}

export function isResponseSlaExpired(
  request: { status: string; expiresAt: Date },
  now = new Date(),
): boolean {
  if (request.status !== 'PENDING') {
    return request.status === 'EXPIRED';
  }
  return now.getTime() > request.expiresAt.getTime();
}

/** Lister may approve or reject while status is open and business dates are still valid. */
export function canListerActOnAvailabilityRequest(
  request: AvailabilityRequestActionFields,
  now = new Date(),
): boolean {
  if (!['PENDING', 'EXPIRED'].includes(request.status)) {
    return false;
  }
  return !isBusinessExpired(request, now);
}

export function responseSlaRemainingSeconds(
  request: { expiresAt: Date },
  now = new Date(),
): number {
  return Math.max(
    0,
    Math.floor((request.expiresAt.getTime() - now.getTime()) / 1000),
  );
}

export function businessRemainingSeconds(
  request: AvailabilityRequestExpiryFields,
  now = new Date(),
): number {
  return Math.max(
    0,
    Math.floor((computeBusinessExpiresAt(request).getTime() - now.getTime()) / 1000),
  );
}

export function getPrimaryDispatchWindowType(
  rentalDays: number | null | undefined,
): DispatchWindowType {
  return (rentalDays ?? 0) === 0 ? 'RESALE' : 'OUTBOUND';
}

export function isPrimaryDispatchWindowExpired(
  request: Record<string, unknown>,
  now = new Date(),
): boolean {
  const type = getPrimaryDispatchWindowType(
    request.rentalDays as number | null | undefined,
  );
  const map = extractRangeMapFromEntity(
    request,
    availabilityRequestWindowFieldMap,
  );
  const window = map[type];
  return !window || isWindowExpired(window, now);
}

/** Lister may approve while business dates are valid and the renter's delivery window has not ended. */
export function canListerApproveAvailabilityRequest(
  request: AvailabilityRequestActionFields & Record<string, unknown>,
  now = new Date(),
): boolean {
  return (
    canListerActOnAvailabilityRequest(request, now) &&
    !isPrimaryDispatchWindowExpired(request, now)
  );
}

/** Lister may ping the renter when the chosen window passed but rental/purchase dates are still valid. */
export function canListerNotifyRenterAfterDispatchWindow(
  request: AvailabilityRequestActionFields & Record<string, unknown>,
  now = new Date(),
): boolean {
  return (
    canListerActOnAvailabilityRequest(request, now) &&
    isPrimaryDispatchWindowExpired(request, now)
  );
}

function requiredDispatchWindowTypes(
  rentalDays: number | null | undefined,
): DispatchWindowType[] {
  if ((rentalDays ?? 0) > 0) {
    return ['OUTBOUND', 'RETURN'];
  }
  if ((rentalDays ?? 0) === 0) {
    return ['RESALE'];
  }
  return [];
}

/** Persist approved windows as chosen by the renter (no silent refresh on approve). */
export function dispatchWindowDataForAvailabilityApproval(
  request: AvailabilityRequestActionFields & Record<string, unknown>,
) {
  const map = extractRangeMapFromEntity(
    request,
    availabilityRequestWindowFieldMap,
  );
  return applyRangeMapToData(map, availabilityRequestWindowFieldMap);
}

export type CheckoutDispatchRefreshResult = {
  map: DispatchWindowRangeMap;
  startDate: Date | null;
  endDate: Date | null;
  totalPrice: number | null;
  rescheduled: boolean;
  rescheduledOutboundSummary?: string;
};

/** Roll stale checkout windows forward and shift rental dates as one bundle. */
export function refreshAvailabilityDispatchForCheckout(
  request: AvailabilityRequestActionFields & Record<string, unknown>,
  dailyPrice: number,
  now = new Date(),
): CheckoutDispatchRefreshResult {
  const rentalDays = request.rentalDays ?? 0;
  const required = requiredDispatchWindowTypes(rentalDays);
  let map = extractRangeMapFromEntity(
    request,
    availabilityRequestWindowFieldMap,
  );

  const anyExpired = required.some((type) => {
    const w = map[type];
    return !w || isWindowExpired(w, now);
  });

  if (!anyExpired) {
    return {
      map,
      startDate: (request.startDate as Date | null) ?? null,
      endDate: (request.endDate as Date | null) ?? null,
      totalPrice: (request.totalPrice as number | null) ?? null,
      rescheduled: false,
    };
  }

  const bases = resolveRentalDispatchWindowBases({
    startDate: (request.startDate as Date | null) ?? null,
    endDate: (request.endDate as Date | null) ?? null,
    rentalDays,
    now,
  });

  for (const type of required) {
    const w = map[type];
    if (!w || isWindowExpired(w, now)) {
      if (type === 'OUTBOUND') {
        map[type] = buildDefaultDispatchWindow(bases.outbound);
      } else if (type === 'RETURN') {
        map[type] = buildDefaultDispatchWindow(bases.returnLeg);
      } else {
        map[type] = buildDefaultDispatchWindow(bases.resale);
      }
    }
  }

  let startDate = (request.startDate as Date | null) ?? null;
  let endDate = (request.endDate as Date | null) ?? null;
  let totalPrice = (request.totalPrice as number | null) ?? null;

  if (rentalDays > 0 && map.OUTBOUND) {
    startDate = lagosMidnightFromCalendarKey(
      getLagosCalendarDateKey(map.OUTBOUND.start),
    );
    endDate = addDays(startDate, Math.max(0, rentalDays - 1));
    map = ensureRentalReturnDispatchWindow(
      map,
      { startDate, rentalDays },
      now,
    );
    totalPrice = Math.round(dailyPrice * rentalDays);
  } else if (rentalDays === 0 && dailyPrice > 0) {
    totalPrice = Math.round(dailyPrice);
  }

  const outbound = map.OUTBOUND ?? map.RESALE;
  const rescheduledOutboundSummary = outbound
    ? formatDispatchWindowSummaryLagos(outbound.start, outbound.end)
    : undefined;

  return {
    map,
    startDate,
    endDate,
    totalPrice,
    rescheduled: true,
    rescheduledOutboundSummary,
  };
}

function formatDispatchWindowSummaryLagos(start: Date, end: Date): string {
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

export function formatDispatchWindowSummaryFromRequest(
  request: Record<string, unknown>,
  type: DispatchWindowType,
): string | null {
  const map = extractRangeMapFromEntity(
    request,
    availabilityRequestWindowFieldMap,
  );
  const window = map[type];
  if (!window) return null;
  return formatDispatchWindowSummaryLagos(window.start, window.end);
}
