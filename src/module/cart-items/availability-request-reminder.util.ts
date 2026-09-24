const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * MS_MINUTE;

export type CheckoutReminderStage = '30m' | '2h';
export type ExpiredListerReminderStage = '1' | '2';

export type AvailabilityRequestReminderState = {
  checkout?: Partial<Record<CheckoutReminderStage, string>>;
  expiredLister?: Partial<Record<ExpiredListerReminderStage, string>>;
};

export type AvailabilityReminderAction =
  | { track: 'checkout'; stage: CheckoutReminderStage }
  | { track: 'expiredLister'; stage: ExpiredListerReminderStage };

/** Renter: approved but not checked out (max 2). */
export const CHECKOUT_REMINDER_OFFSETS_MS: Record<CheckoutReminderStage, number> =
  {
    '30m': 30 * MS_MINUTE,
    '2h': 2 * MS_HOUR,
  };

/** Lister: expired with no response (max 2). */
export const EXPIRED_LISTER_REMINDER_OFFSETS_MS: Record<
  ExpiredListerReminderStage,
  number
> = {
  '1': 1 * MS_HOUR,
  '2': 2 * MS_HOUR,
};

const CHECKOUT_STAGES: CheckoutReminderStage[] = ['30m', '2h'];
const EXPIRED_LISTER_STAGES: ExpiredListerReminderStage[] = ['1', '2'];

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

export type CheckoutReminderItem = {
  productName: string;
  requestType: 'purchase' | 'rental';
  listerName?: string;
};

export type ExpiredListerReminderItem = {
  productName: string;
  requestType: 'purchase' | 'rental';
  renterName: string;
  orderLink: string;
};

export type ReminderRequestKind = 'purchase' | 'rental' | 'mixed';

function reminderRequestKind(
  items: Array<{ requestType: 'purchase' | 'rental' }>,
): ReminderRequestKind {
  const kinds = new Set(items.map((item) => item.requestType));
  if (kinds.size !== 1) return 'mixed';
  return items[0]?.requestType === 'purchase' ? 'purchase' : 'rental';
}

function checkoutReminderTitle(kind: ReminderRequestKind, count: number): string {
  if (kind === 'mixed') return 'Complete your checkout';
  if (kind === 'purchase') {
    return count > 1 ? 'Complete your purchases' : 'Complete your purchase';
  }
  return count > 1 ? 'Complete your rentals' : 'Complete your rental';
}

function expiredListerReminderTitle(
  kind: ReminderRequestKind,
  count: number,
): string {
  if (count > 1) return 'Requests waiting on you';
  if (kind === 'purchase') return 'Purchase request waiting on you';
  return 'Rental request waiting on you';
}

export function checkoutReminderCopy(params: {
  productName: string;
  requestType: 'purchase' | 'rental';
  stage: CheckoutReminderStage;
}): { title: string; message: string; requestType: ReminderRequestKind } {
  const requestType = params.requestType;
  const title = checkoutReminderTitle(requestType, 1);
  const message =
    params.stage === '30m'
      ? `${params.productName} is available. Open your cart and check out to lock it in.`
      : `Last reminder: check out now so you don’t lose ${params.productName}.`;
  return { title, message, requestType };
}

export function checkoutReminderBatchCopy(params: {
  items: CheckoutReminderItem[];
  stage: CheckoutReminderStage;
}): { title: string; message: string; requestType: ReminderRequestKind } {
  const count = params.items.length;
  const requestType = reminderRequestKind(params.items);
  const title = checkoutReminderTitle(requestType, count);
  const names = params.items.map((item) => item.productName).join(', ');

  if (count === 1) {
    return checkoutReminderCopy({
      productName: params.items[0].productName,
      requestType: params.items[0].requestType,
      stage: params.stage,
    });
  }

  const message =
    params.stage === '30m'
      ? `${count} approved items are waiting in your cart: ${names}. Check out to lock them in.`
      : `Last reminder: check out for ${count} items before you lose them: ${names}.`;

  return { title, message, requestType };
}

export function expiredListerReminderCopy(params: {
  productName: string;
  requestType: 'purchase' | 'rental';
  renterName: string;
  stage: ExpiredListerReminderStage;
}): { title: string; message: string; requestType: ReminderRequestKind } {
  const requestType = params.requestType;
  const title = expiredListerReminderTitle(requestType, 1);
  const message = `${params.renterName} is still waiting to ${
    params.requestType === 'purchase' ? 'buy' : 'rent'
  } ${params.productName}. You can still confirm availability from your dashboard while their dates are valid.`;
  return { title, message, requestType };
}

export function expiredListerReminderBatchCopy(params: {
  items: ExpiredListerReminderItem[];
  stage: ExpiredListerReminderStage;
}): { title: string; message: string; requestType: ReminderRequestKind } {
  const count = params.items.length;
  const requestType = reminderRequestKind(params.items);
  const title = expiredListerReminderTitle(requestType, count);

  if (count === 1) {
    return expiredListerReminderCopy({
      productName: params.items[0].productName,
      requestType: params.items[0].requestType,
      renterName: params.items[0].renterName,
      stage: params.stage,
    });
  }

  const summary = params.items
    .map(
      (item) =>
        `${item.renterName} (${item.productName})`,
    )
    .join('; ');

  return {
    title,
    message: `${count} requests are still waiting on you: ${summary}. Review them from your dashboard while dates are valid.`,
    requestType,
  };
}
