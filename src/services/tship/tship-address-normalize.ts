/** Cities Terminal accepts on quotes in Lagos state (sandbox/live spot checks). */
const TERMINAL_LAGOS_CITY_KEYS = new Set([
  'lagos',
  'lekki',
  'ikoyi',
  'ikeja',
  'ajah',
  'yaba',
  'surulere',
  'vi',
  'victoria island',
]);

export function normalizeTshipCountryCode(raw: string | null | undefined): string {
  const t = String(raw ?? '').trim();
  if (!t) return 'NG';
  const lower = t.toLowerCase();
  if (lower === 'nigeria' || lower === 'ng' || lower === 'nga') return 'NG';
  if (/^[a-z]{2}$/i.test(t)) return t.toUpperCase();
  return 'NG';
}

export function normalizeTshipZip(raw: string | null | undefined): string {
  const z = String(raw ?? '').trim();
  return z || '100001';
}

/**
 * Terminal validates `city` against their catalog. Lagos metro subareas like Ogba
 * often need to be sent as Lagos while `line1` keeps the neighborhood.
 */
export function resolveTshipCity(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  const c = String(city ?? '').trim();
  const stateNorm = String(state ?? '').trim().toLowerCase();
  const inLagosState =
    stateNorm.includes('lagos') || c.toLowerCase().includes('lagos');
  if (!c) return inLagosState ? 'Lagos' : 'Lagos';
  const key = c.toLowerCase();
  if (inLagosState && !TERMINAL_LAGOS_CITY_KEYS.has(key)) {
    return 'Lagos';
  }
  return c;
}

export function normalizeTshipLine1(
  street: string | null | undefined,
  fallbackLine: string,
): string {
  const streetLine = String(street ?? '').trim();
  if (streetLine) return streetLine;
  return String(fallbackLine ?? '').trim() || 'Lagos, Nigeria';
}

/** Nigerian mobile: +234 plus 10 digits. */
export function normalizeTshipPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  let national = '';
  if (digits.startsWith('234')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  if (national.length > 10) national = national.slice(-10);
  if (national.length === 10) return `+234${national}`;
  return '+2348000000000';
}

export function tshipApiErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const ax = err as {
      response?: { data?: { message?: unknown }; status?: number };
      message?: string;
    };
    const apiMsg = ax.response?.data?.message;
    if (typeof apiMsg === 'string' && apiMsg.trim()) return apiMsg.trim();
    if (ax.response?.status) {
      return `HTTP ${ax.response.status}`;
    }
    if (typeof ax.message === 'string' && ax.message.trim()) {
      return ax.message.trim();
    }
  }
  return 'Carrier API request failed';
}
