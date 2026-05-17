import { createHash } from 'crypto';

export type ShipbubbleAddressContact = {
  name: string;
  email: string;
  phone: string;
  addressLine: string;
};

/**
 * Shipbubble address validation expects a full name (e.g. "John Doe") with no digits/symbols.
 * @see https://docs.shipbubble.com/api-reference/addresses/validate-address-global
 */
export function sanitizeShipbubbleContactName(
  raw: string | null | undefined,
  fallback = 'Relisted Customer',
): string {
  const cleaned = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = cleaned.split(' ').filter((part) => part.length >= 2);

  if (parts.length >= 2) {
    return parts.slice(0, 4).join(' ');
  }

  const single = parts[0] ?? '';
  if (single.length >= 2) {
    return `${single} Customer`;
  }

  return fallback;
}

/** E.164 Nigeria (+234…) for Shipbubble address validation. */
export function sanitizeShipbubblePhone(
  raw: string | null | undefined,
): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('234')) digits = digits.slice(3);
  while (digits.startsWith('0') && digits.length > 10) digits = digits.slice(1);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length > 10) digits = digits.slice(-10);
  if (digits.length === 10 && /^[789]/.test(digits)) {
    return `+234${digits}`;
  }
  return '+2348000000000';
}

const STREET_ABBREVIATIONS: Record<string, string> = {
  st: 'street',
  str: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  cres: 'crescent',
  cl: 'close',
};

/**
 * Build a single address line for Shipbubble (street, city, state, country) with deduped parts.
 */
export function formatShipbubbleAddressLine(snapshot: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
} | null | undefined): string {
  if (!snapshot) return '';
  const country = String(snapshot.country ?? 'Nigeria').trim() || 'Nigeria';
  const raw = [snapshot.street, snapshot.city, snapshot.state, country]
    .map((p) => (p != null ? String(p).trim() : ''))
    .filter(Boolean);
  const parts: string[] = [];
  for (const part of raw) {
    const last = parts[parts.length - 1];
    if (!last || last.toLowerCase() !== part.toLowerCase()) {
      parts.push(part);
    }
  }
  return parts.join(', ');
}

/** Lowercase, strip punctuation, expand common street abbreviations for fingerprinting. */
export function normalizeAddressLineForFingerprint(raw: string): string {
  let text = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  const tokens = text.split(' ').map((token) => {
    const expanded = STREET_ABBREVIATIONS[token];
    return expanded ?? token;
  });

  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

export type ShipbubbleAddressFingerprint = {
  normalizedName: string;
  normalizedPhone: string;
  normalizedAddressLine: string;
  addressHash: string;
};

/** Sandbox vs production address codes are not interchangeable across API keys. */
export function shipbubbleApiCacheScope(
  apiKey: string | null | undefined = process.env.SHIPBUBBLE_API_KEY,
): string {
  const key = String(apiKey ?? '').trim();
  if (key.startsWith('sb_sandbox_')) return 'sandbox';
  if (key.startsWith('sb_prod_')) return 'production';
  return 'unknown';
}

export function isShipbubbleSandboxApiKey(
  apiKey: string | null | undefined = process.env.SHIPBUBBLE_API_KEY,
): boolean {
  return shipbubbleApiCacheScope(apiKey) === 'sandbox';
}

export function buildShipbubbleAddressFingerprint(
  contact: ShipbubbleAddressContact,
): ShipbubbleAddressFingerprint {
  const normalizedName = sanitizeShipbubbleContactName(
    contact.name,
    'Relisted Customer',
  );
  const normalizedPhone = sanitizeShipbubblePhone(contact.phone);
  const normalizedAddressLine = normalizeAddressLineForFingerprint(
    String(contact.addressLine ?? '').trim(),
  );

  const payload = [
    shipbubbleApiCacheScope(),
    normalizedName.toLowerCase(),
    normalizedPhone,
    normalizedAddressLine,
  ].join('|');

  const addressHash = createHash('sha256').update(payload).digest('hex');

  return {
    normalizedName,
    normalizedPhone,
    normalizedAddressLine,
    addressHash,
  };
}
