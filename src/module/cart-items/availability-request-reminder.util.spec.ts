import {
  applyAvailabilityRequestReminderState,
  CHECKOUT_REMINDER_OFFSETS_MS,
  checkoutReminderBatchCopy,
  computeCheckoutReminderActions,
  computeExpiredListerReminderActions,
  expiredListerReminderBatchCopy,
  EXPIRED_LISTER_REMINDER_OFFSETS_MS,
} from './availability-request-reminder.util';

describe('availability-request-reminder.util', () => {
  const base = new Date('2026-07-15T12:00:00.000Z');

  it('computes checkout reminders at 15m, 1h, and 2h without double-sending', () => {
    const approvedAt = new Date(base.getTime() - 20 * 60 * 1000);
    const first = computeCheckoutReminderActions(base, approvedAt, null);
    expect(first.map((a) => a.stage)).toEqual(['15m']);

    const afterFirst = applyAvailabilityRequestReminderState(
      null,
      first[0],
      base,
    );
    const atOneHour = new Date(
      approvedAt.getTime() + CHECKOUT_REMINDER_OFFSETS_MS['1h'],
    );
    const second = computeCheckoutReminderActions(
      atOneHour,
      approvedAt,
      afterFirst,
    );
    expect(second.map((a) => a.stage)).toEqual(['1h']);

    const afterSecond = applyAvailabilityRequestReminderState(
      afterFirst,
      second[0],
      atOneHour,
    );
    const atTwoHours = new Date(
      approvedAt.getTime() + CHECKOUT_REMINDER_OFFSETS_MS['2h'],
    );
    const third = computeCheckoutReminderActions(
      atTwoHours,
      approvedAt,
      afterSecond,
    );
    expect(third.map((a) => a.stage)).toEqual(['2h']);

    const afterAll = applyAvailabilityRequestReminderState(
      afterSecond,
      third[0],
      atTwoHours,
    );
    expect(
      computeCheckoutReminderActions(atTwoHours, approvedAt, afterAll),
    ).toEqual([]);
  });

  it('computes expired lister reminders at 30m, 1h, and 2h', () => {
    const expiresAt = new Date(
      base.getTime() - EXPIRED_LISTER_REMINDER_OFFSETS_MS['1'] - 1000,
    );
    expect(
      computeExpiredListerReminderActions(base, expiresAt, null).map(
        (a) => a.stage,
      ),
    ).toEqual(['1']);

    const atTwoHours = new Date(
      expiresAt.getTime() + EXPIRED_LISTER_REMINDER_OFFSETS_MS['3'] + 1000,
    );
    expect(
      computeExpiredListerReminderActions(atTwoHours, expiresAt, null).map(
        (a) => a.stage,
      ),
    ).toEqual(['1', '2', '3']);
  });

  it('builds grouped checkout copy for multiple items', () => {
    const copy = checkoutReminderBatchCopy({
      stage: '15m',
      items: [
        { productName: 'Silk dress', requestType: 'rental' },
        { productName: 'Linen set', requestType: 'rental' },
      ],
    });

    expect(copy.title).toBe('Complete your rentals');
    expect(copy.message).toContain('2 approved items');
    expect(copy.message).toContain('Silk dress');
    expect(copy.message).toContain('Linen set');
  });

  it('builds grouped expired lister copy for multiple requests', () => {
    const copy = expiredListerReminderBatchCopy({
      stage: '1',
      items: [
        {
          productName: 'Silk dress',
          requestType: 'rental',
          renterName: 'Renter One',
          orderLink: 'https://app.test/orders/1',
        },
        {
          productName: 'Bag',
          requestType: 'purchase',
          renterName: 'Renter Two',
          orderLink: 'https://app.test/orders/2',
        },
      ],
    });

    expect(copy.title).toBe('Requests waiting on you');
    expect(copy.message).toContain('2 requests are still waiting');
    expect(copy.message).toContain('Renter One (Silk dress)');
    expect(copy.message).toContain('Renter Two (Bag)');
  });
});
