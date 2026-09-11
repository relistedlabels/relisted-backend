/** Lagos same-day couriers we trust via Terminal T-Ship (slug substrings). */
export const TSHIP_ALLOWED_CARRIER_KEYS = [
  'kwik',
  'gigl',
  'gig-logistics',
  'gokada',
  'chowdeck',
  'glovo',
] as const;

/** Line-haul / multi-day carriers to never surface at checkout. */
export const TSHIP_BLOCKED_CARRIER_KEYS = [
  'fez',
  'dellyman',
  'topship',
  'dhl',
  'fedex',
  'ups',
  'aramex',
  'air-cargo',
  'terminal-express',
  'terminal-premium',
  'terminal-cargo',
  'sendstack',
  'qc-express',
  'qc express',
] as const;

export type TshipRateLike = {
  carrier_slug?: string;
  carrier_name?: string;
  carrier_rate_description?: string;
  delivery_eta?: number;
  delivery_time?: string;
  pickup_time?: string;
  type?: string;
  cargo_type?: string;
  dropoff_required?: boolean;
};

function normalizedCarrierHaystack(rate: TshipRateLike): string {
  return [
    rate.carrier_slug,
    rate.carrier_name,
    rate.carrier_rate_description,
  ]
    .map((p) => String(p ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
    .replace(/[^a-z0-9]+/g, ' ');
}

export function carrierSlugMatchesKeys(
  haystack: string,
  keys: readonly string[],
): boolean {
  const norm = haystack.replace(/[^a-z0-9]+/g, ' ');
  return keys.some((key) => {
    const k = key.replace(/[^a-z0-9]+/g, ' ');
    return norm.includes(k);
  });
}

export function isBlockedTshipCarrier(rate: TshipRateLike): boolean {
  return carrierSlugMatchesKeys(
    normalizedCarrierHaystack(rate),
    TSHIP_BLOCKED_CARRIER_KEYS,
  );
}

export function isAllowedTshipCarrier(rate: TshipRateLike): boolean {
  if (isBlockedTshipCarrier(rate)) return false;
  return carrierSlugMatchesKeys(
    normalizedCarrierHaystack(rate),
    TSHIP_ALLOWED_CARRIER_KEYS,
  );
}

/** delivery_eta from Terminal is minutes until delivery. */
export function isSameDayTshipRate(rate: TshipRateLike): boolean {
  const deliveryTime = String(rate.delivery_time ?? '').toLowerCase();
  if (/same\s*day|same-day/.test(deliveryTime)) return true;
  if (/within\s+\d+\s+hour/.test(deliveryTime)) return true;
  if (/within\s+1\s+day/.test(deliveryTime)) return true;

  if (/within\s+[2-9]\d*\s+day/.test(deliveryTime)) return false;
  if (/within\s+\d+\s+day/.test(deliveryTime)) {
    const m = deliveryTime.match(/within\s+(\d+)\s+day/);
    if (m && Number(m[1]) > 1) return false;
  }

  const eta = Number(rate.delivery_eta);
  if (Number.isFinite(eta) && eta > 0) {
    return eta <= 24 * 60;
  }

  const cargo = String(rate.cargo_type ?? rate.type ?? '').toLowerCase();
  if (cargo.includes('air') || cargo === 'cargo') return false;

  return false;
}

export function isEligibleTshipQuoteRate(
  rate: TshipRateLike,
  options?: { sameDayOnly?: boolean },
): boolean {
  if (!isAllowedTshipCarrier(rate)) return false;
  if (options?.sameDayOnly === false) return true;
  return isSameDayTshipRate(rate);
}
