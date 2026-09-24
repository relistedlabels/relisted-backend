import {
  applyAvailabilityRequestReminderState,
  CHECKOUT_REMINDER_OFFSETS_MS,
  computeCheckoutReminderActions,
  computeExpiredListerReminderActions,
  EXPIRED_LISTER_REMINDER_OFFSETS_MS,
} from './availability-request-reminder.util';

describe('availability-request-reminder.util', () => {
  const base = new Date('2026-07-15T12:00:00.000Z');

  it('computes checkout reminders at 30m and 2h without double-sending', () => {
    const approvedAt = new Date(base.getTime() - 35 * 60 * 1000);
    const first = computeCheckoutReminderActions(base, approvedAt, null);
    expect(first.map((a) => a.stage)).toEqual(['30m']);

    const afterFirst = applyAvailabilityRequestReminderState(
      null,
      first[0],
      base,
    );
    const atTwoHours = new Date(
      approvedAt.getTime() + CHECKOUT_REMINDER_OFFSETS_MS['2h'],
    );
    const second = computeCheckoutReminderActions(
      atTwoHours,
      approvedAt,
      afterFirst,
    );
    expect(second.map((a) => a.stage)).toEqual(['2h']);

    const afterAll = applyAvailabilityRequestReminderState(
      afterFirst,
      second[0],
      atTwoHours,
    );
    expect(
      computeCheckoutReminderActions(atTwoHours, approvedAt, afterAll),
    ).toEqual([]);
  });

  it('computes expired lister reminders at 1h and 2h', () => {
    const expiresAt = new Date(
      base.getTime() - EXPIRED_LISTER_REMINDER_OFFSETS_MS['1'] - 1000,
    );
    expect(
      computeExpiredListerReminderActions(base, expiresAt, null).map(
        (a) => a.stage,
      ),
    ).toEqual(['1']);

    const atTwoHours = new Date(
      expiresAt.getTime() + EXPIRED_LISTER_REMINDER_OFFSETS_MS['2'] + 1000,
    );
    expect(
      computeExpiredListerReminderActions(atTwoHours, expiresAt, null).map(
        (a) => a.stage,
      ),
    ).toEqual(['1', '2']);
  });
});
