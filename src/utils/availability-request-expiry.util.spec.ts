import { addDays, addMinutes } from 'date-fns';
import {
  AVAILABILITY_RESPONSE_SLA_MINUTES,
  canListerActOnAvailabilityRequest,
  canListerApproveAvailabilityRequest,
  canListerNotifyRenterAfterDispatchWindow,
  computeBusinessExpiresAt,
  isBusinessExpired,
  isPrimaryDispatchWindowExpired,
  isResponseSlaExpired,
  refreshAvailabilityDispatchForCheckout,
} from './availability-request-expiry.util';

describe('availability-request-expiry.util', () => {
  const rentalStart = new Date('2026-10-15T00:00:00+01:00');

  it('uses rental start day end as business expiry', () => {
    const expiresAt = computeBusinessExpiresAt({
      rentalDays: 3,
      startDate: rentalStart,
      resaleWindowEnd: null,
      createdAt: new Date('2026-09-01T12:00:00Z'),
    });
    expect(expiresAt.toISOString()).toBe('2026-10-15T22:59:59.999Z');
  });

  it('uses resale window end for purchase requests', () => {
    const resaleEnd = new Date('2026-09-20T14:00:00Z');
    const expiresAt = computeBusinessExpiresAt({
      rentalDays: 0,
      startDate: null,
      resaleWindowEnd: resaleEnd,
      createdAt: new Date('2026-09-01T12:00:00Z'),
    });
    expect(expiresAt).toEqual(resaleEnd);
  });

  it('allows lister action on EXPIRED response SLA while business dates valid', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    expect(
      canListerActOnAvailabilityRequest(
        {
          status: 'EXPIRED',
          rentalDays: 3,
          startDate: rentalStart,
          resaleWindowEnd: null,
          createdAt: now,
          expiresAt: addMinutes(now, -AVAILABILITY_RESPONSE_SLA_MINUTES),
        },
        now,
      ),
    ).toBe(true);
  });

  it('blocks lister action after rental start day passes', () => {
    const now = new Date('2026-10-16T01:00:00+01:00');
    expect(
      canListerActOnAvailabilityRequest(
        {
          status: 'EXPIRED',
          rentalDays: 3,
          startDate: rentalStart,
          resaleWindowEnd: null,
          createdAt: addDays(rentalStart, -10),
          expiresAt: addDays(rentalStart, -10),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isBusinessExpired(
        {
          rentalDays: 3,
          startDate: rentalStart,
          resaleWindowEnd: null,
          createdAt: addDays(rentalStart, -10),
        },
        now,
      ),
    ).toBe(true);
  });

  it('marks response SLA expired for PENDING past expiresAt', () => {
    const now = new Date();
    expect(
      isResponseSlaExpired(
        { status: 'PENDING', expiresAt: addMinutes(now, -1) },
        now,
      ),
    ).toBe(true);
    expect(
      isResponseSlaExpired(
        { status: 'EXPIRED', expiresAt: addMinutes(now, -1) },
        now,
      ),
    ).toBe(true);
  });

  it('blocks approve when outbound window has passed', () => {
    const now = new Date();
    const request = {
      status: 'PENDING',
      rentalDays: 1,
      startDate: rentalStart,
      endDate: rentalStart,
      resaleWindowEnd: null,
      createdAt: now,
      expiresAt: addMinutes(now, 10),
      outboundWindowStart: addMinutes(now, -120),
      outboundWindowEnd: addMinutes(now, -60),
      returnWindowStart: addMinutes(now, 24 * 60),
      returnWindowEnd: addMinutes(now, 25 * 60),
    };
    expect(isPrimaryDispatchWindowExpired(request, now)).toBe(true);
    expect(canListerApproveAvailabilityRequest(request, now)).toBe(false);
    expect(canListerNotifyRenterAfterDispatchWindow(request, now)).toBe(true);
  });

  it('refreshes checkout windows and shifts rental start with fixed rentalDays', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-25T18:00:00+01:00'));

    const startDate = new Date('2026-06-25T00:00:00+01:00');
    const request = {
      status: 'ACCEPTED',
      rentalDays: 1,
      startDate,
      endDate: startDate,
      resaleWindowEnd: null,
      createdAt: startDate,
      expiresAt: startDate,
      outboundWindowStart: new Date('2026-06-25T10:00:00+01:00'),
      outboundWindowEnd: new Date('2026-06-25T11:00:00+01:00'),
      returnWindowStart: new Date('2026-06-26T10:00:00+01:00'),
      returnWindowEnd: new Date('2026-06-26T11:00:00+01:00'),
    };

    const refresh = refreshAvailabilityDispatchForCheckout(request, 5000);
    expect(refresh.rescheduled).toBe(true);
    expect(refresh.totalPrice).toBe(5000);
    expect(refresh.startDate?.toISOString()).toBe(
      '2026-06-25T23:00:00.000Z',
    );
    expect(refresh.map.RETURN).toBeDefined();
    jest.useRealTimers();
  });
});
