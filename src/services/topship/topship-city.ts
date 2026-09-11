/**
 * Map Relisted address cities to exact Topship `get-cities` names (case/spacing).
 * Prefer a dedicated Topship city (LEKKI, IKOYI, OGBA) over coarse LAGOS buckets.
 */

export type TopshipAddressBits = {
  street?: string | null;
  city?: string | null;
  state?: string | null;
};

/** User input (normalized key) → Topship `cityName` from get-cities (NG). */
const TOPSHIP_CANONICAL_CITY = new Map<string, string>([
  ['lagos', 'LAGOS'],
  ['lagos mainland', 'LAGOS MAINLAND'],
  ['lagos island', 'LAGOS ISLAND'],
  ['kosofe', 'KOSOFE'],
  ['isolo', 'ISOLO'],
  ['lekki', 'LEKKI'],
  ['lekki 1', 'LEKKI 1'],
  ['lekki phase 1', 'LEKKI PHASE 1'],
  ['lekki phase one', 'LEKKI PHASE 1'],
  ['ikoyi', 'IKOYI'],
  ['ogba', 'OGBA'],
  ['yaba', 'YABA'],
  ['ikeja', 'IKEJA'],
  ['ikeja gra', 'IKEJA GRA'],
  ['surulere', 'SURULERE'],
  ['ajah', 'AJAH'],
  ['victoria island', 'VICTORIA ISLAND'],
  ['vi', 'VICTORIA ISLAND'],
  ['abuja', 'ABUJA'],
  ['port harcourt', 'PORT HARCOURT'],
  ['ibadan', 'IBADAN'],
]);

/** Areas without their own get-cities row → nearest Topship bucket. */
const LAGOS_NEIGHBORHOOD_TO_TOPSHIP: Record<string, string> = {
  mushin: 'LAGOS MAINLAND',
  maryland: 'LAGOS MAINLAND',
  anthony: 'LAGOS MAINLAND',
  ilupeju: 'LAGOS MAINLAND',
  palmgrove: 'LAGOS MAINLAND',
  bariga: 'LAGOS MAINLAND',
  shomolu: 'LAGOS MAINLAND',
  somolu: 'LAGOS MAINLAND',
  gbagada: 'LAGOS MAINLAND',
  ojota: 'LAGOS MAINLAND',
  ketu: 'LAGOS MAINLAND',
  magodo: 'LAGOS MAINLAND',
  ojodu: 'LAGOS MAINLAND',
  berger: 'LAGOS MAINLAND',
  agege: 'LAGOS MAINLAND',
  ipaja: 'LAGOS MAINLAND',
  ejigbo: 'LAGOS MAINLAND',
  idimu: 'LAGOS MAINLAND',
  egbeda: 'LAGOS MAINLAND',
  ikotun: 'LAGOS MAINLAND',
  igando: 'LAGOS MAINLAND',
  festac: 'LAGOS MAINLAND',
  amuwo: 'LAGOS MAINLAND',
  apapa: 'LAGOS MAINLAND',
  oworonshoki: 'LAGOS MAINLAND',
  'banana island': 'LAGOS ISLAND',
  falomo: 'LAGOS ISLAND',
  onikan: 'LAGOS ISLAND',
  obalende: 'LAGOS ISLAND',
  marina: 'LAGOS ISLAND',
};

/** Longest keys first so "lekki phase 1" wins over "lekki". */
const HAYSTACK_NEIGHBORHOOD_KEYS = [
  ...Object.keys(TOPSHIP_CANONICAL_CITY).filter((k) => k.includes(' ')),
  ...Object.keys(LAGOS_NEIGHBORHOOD_TO_TOPSHIP),
  ...Object.keys(TOPSHIP_CANONICAL_CITY).filter((k) => !k.includes(' ')),
].sort((a, b) => b.length - a.length);

function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isLagosState(state: string, city: string, haystack: string): boolean {
  const s = state.toLowerCase();
  const c = city.toLowerCase();
  return (
    s.includes('lagos') ||
    c === 'lagos' ||
    c.includes('lagos') ||
    haystack.includes('lagos')
  );
}

function matchFromHaystack(haystack: string): string | null {
  for (const key of HAYSTACK_NEIGHBORHOOD_KEYS) {
    if (!haystack.includes(key)) continue;
    return (
      TOPSHIP_CANONICAL_CITY.get(key) ??
      LAGOS_NEIGHBORHOOD_TO_TOPSHIP[key] ??
      null
    );
  }
  return null;
}

/**
 * Resolve a Relisted address city to a Topship `get-cities` name.
 */
export function resolveTopshipCityName(input: TopshipAddressBits): string {
  const rawCity = String(input.city ?? '').trim();
  const state = String(input.state ?? '').trim();
  const street = String(input.street ?? '').trim();
  const haystack = `${rawCity} ${street}`.toLowerCase();

  if (rawCity) {
    const canonical = TOPSHIP_CANONICAL_CITY.get(normKey(rawCity));
    if (canonical) return canonical;

    const mapped = LAGOS_NEIGHBORHOOD_TO_TOPSHIP[normKey(rawCity)];
    if (mapped) return mapped;
  }

  const fromHaystack = matchFromHaystack(haystack);
  if (fromHaystack) return fromHaystack;

  if (isLagosState(state, rawCity, haystack)) {
    return 'LAGOS MAINLAND';
  }

  if (rawCity) return rawCity.toUpperCase();
  return 'LAGOS';
}

/** Pickup / get-pickup-rates `senderDetail` city + address line. */
export function buildTopshipSenderDetail(
  address: TopshipAddressBits,
): Record<string, string> {
  const rawCity = String(address.city ?? '').trim();
  const state = String(address.state ?? 'Lagos').trim() || 'Lagos';
  const street = String(address.street ?? '').trim();
  const city = resolveTopshipCityName({ city: rawCity, state, street });
  let addressLine1 = street || `${rawCity || city}, Nigeria`;
  if (rawCity && normKey(rawCity) !== normKey(city)) {
    if (!addressLine1.toLowerCase().includes(normKey(rawCity))) {
      addressLine1 = addressLine1 ? `${addressLine1}, ${rawCity}` : rawCity;
    }
  }
  return {
    addressLine1,
    addressLine2: '',
    country: 'Nigeria',
    countryCode: 'NG',
    state,
    city,
  };
}

export function normalizeTopshipPickupRatePayload(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = { ...(data as Record<string, unknown>) };
  const sender = d.senderDetail;
  if (!sender || typeof sender !== 'object') return d;
  const s = sender as Record<string, unknown>;
  const built = buildTopshipSenderDetail({
    street: String(s.addressLine1 ?? ''),
    city: String(s.city ?? ''),
    state: String(s.state ?? ''),
  });
  d.senderDetail = { ...s, ...built };
  return d;
}

export function normalizeTopshipShipmentRatePayload(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = { ...(data as Record<string, unknown>) };
  const patch = (key: 'senderDetails' | 'receiverDetails') => {
    const block = d[key];
    if (!block || typeof block !== 'object') return;
    const b = block as Record<string, unknown>;
    const cityName = resolveTopshipCityName({
      city: String(b.cityName ?? ''),
      state: String(b.state ?? ''),
      street: String(b.addressLine1 ?? ''),
    });
    d[key] = { ...b, cityName };
  };
  patch('senderDetails');
  patch('receiverDetails');
  return d;
}

export function normalizeTopshipBookingDetail(
  detail: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!detail || typeof detail !== 'object') return detail ?? {};
  const built = buildTopshipSenderDetail({
    street: String(detail.addressLine1 ?? ''),
    city: String(detail.city ?? ''),
    state: String(detail.state ?? ''),
  });
  return { ...detail, ...built };
}
