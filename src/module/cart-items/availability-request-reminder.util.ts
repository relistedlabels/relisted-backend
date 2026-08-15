const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * MS_MINUTE;

export type CheckoutReminderStage = '15m' | '1h' | '2h';
export type ExpiredListerReminderStage = '1' | '2' | '3';

export type AvailabilityRequestReminderState = {
  checkout?: Partial<Record<CheckoutReminderStage, string>>;
  expiredLister?: Partial<Record<ExpiredListerReminderStage, string>>;
};

export type AvailabilityReminderAction =
  | { track: 'checkout'; stage: CheckoutReminderStage }
  | { track: 'expiredLister'; stage: ExpiredListerReminderStage };

/** Renter: approved but not checked out (max 3). */
export const CHECKOUT_REMINDER_OFFSETS_MS: Record<CheckoutReminderStage, number> =
  {
    '15m': 15 * MS_MINUTE,
    '1h': 1 * MS_HOUR,
    '2h': 2 * MS_HOUR,
  };

/** Lister: expired with no response (max 3). */
export const EXPIRED_LISTER_REMINDER_OFFSETS_MS: Record<
  ExpiredListerReminderStage,
  number
> = {
  '1': 30 * MS_MINUTE,
  '2': 1 * MS_HOUR,
  '3': 2 * MS_HOUR,
};

const CHECKOUT_STAGES: CheckoutReminderStage[] = ['15m', '1h', '2h'];
const EXPIRED_LISTER_STAGES: ExpiredListerReminderStage[] = ['1', '2', '3'];

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseAvailabilityRequestReminderState(
  raw: unknown,
): AvailabilityRequestReminderState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as AvailabilityRequestReminderState;
  return {
    checkout:
      o.checkout && typeof o.checkout === 'object' ? o.checkout : undefined,
    expiredLister:
      o.expiredLister && typeof o.expiredLister === 'object'
        ? o.expiredLister
        : undefined,
  };
}

export function applyAvailabilityRequestReminderState(
  raw: unknown,
  action: AvailabilityReminderAction,
  now: Date,
): AvailabilityRequestReminderState {
  const state = parseAvailabilityRequestReminderState(raw);
  if (action.track === 'checkout') {
    return {
      ...state,
      checkout: {
        ...state.checkout,
        [action.stage]: now.toISOString(),
      },
    };
  }
  return {
    ...state,
    expiredLister: {
      ...state.expiredLister,
      [action.stage]: now.toISOString(),
    },
  };
}

export function computeCheckoutReminderActions(
  now: Date,
  approvedAt: Date | string | null | undefined,
  reminderState: unknown,
): AvailabilityReminderAction[] {
  const approved = toDate(approvedAt);
  if (!approved) return [];

  const state = parseAvailabilityRequestReminderState(reminderState);
  const age = now.getTime() - approved.getTime();
  const actions: AvailabilityReminderAction[] = [];

  for (const stage of CHECKOUT_STAGES) {
    if (state.checkout?.[stage]) continue;
    if (age >= CHECKOUT_REMINDER_OFFSETS_MS[stage]) {
      actions.push({ track: 'checkout', stage });
    }
  }
  return actions;
}

export function computeExpiredListerReminderActions(
  now: Date,
  expiresAt: Date | string | null | undefined,
  reminderState: unknown,
): AvailabilityReminderAction[] {
  const expired = toDate(expiresAt);
  if (!expired) return [];

  const state = parseAvailabilityRequestReminderState(reminderState);
  const age = now.getTime() - expired.getTime();
  const actions: AvailabilityReminderAction[] = [];

  for (const stage of EXPIRED_LISTER_STAGES) {
    if (state.expiredLister?.[stage]) continue;
    if (age >= EXPIRED_LISTER_REMINDER_OFFSETS_MS[stage]) {
      actions.push({ track: 'expiredLister', stage });
    }
  }
  return actions;
}

export function checkoutReminderCopy(params: {
  productName: string;
  requestType: 'purchase' | 'rental';
  stage: CheckoutReminderStage;
}): { title: string; message: string } {
  const kind = params.requestType === 'purchase' ? 'purchase' : 'rental';
  const title =
    params.requestType === 'purchase'
      ? 'Complete your purchase'
      : 'Complete your rental';
  const message =
    params.stage === '15m'
      ? `Your ${kind} request for ${params.productName} was approved. Open your cart and check out to lock it in.`
      : params.stage === '1h'
        ? `Reminder: your approved ${kind} for ${params.productName} is still waiting in your cart.`
        : `Last reminder: check out now so you don’t lose ${params.productName}.`;
  return { title, message };
}

export function expiredListerReminderCopy(params: {
  productName: string;
  requestType: 'purchase' | 'rental';
  renterName: string;
  stage: ExpiredListerReminderStage;
}): { title: string; message: string } {
  const kind = params.requestType === 'purchase' ? 'purchase' : 'rental';
  const title =
    params.requestType === 'purchase'
      ? 'You missed a purchase request'
      : 'You missed a rental request';
  const message = `${params.renterName} requested to ${
    params.requestType === 'purchase' ? 'buy' : 'rent'
  } ${params.productName}, but the request expired before you responded. Open the request and tell them you are available if you still want to ${
    params.requestType === 'purchase' ? 'sell' : 'rent out'
  } this item.`;
  return { title, message };
}
