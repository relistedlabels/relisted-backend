import { BadRequestException } from '@nestjs/common';

export const NIGERIA_PHONE_CODE = '+234';

const LOCAL_LENGTH = 10;
const LOCAL_PATTERN = /^[789]\d{9}$/;

function normalizeLocalDigits(local: string): string {
  let digits = local.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
  }
  return digits.length === LOCAL_LENGTH ? digits : '';
}

/** Normalize Nigerian numbers to E.164 (+234…). */
export function normalizePhoneNumber(
  raw: string | null | undefined,
): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(NIGERIA_PHONE_CODE)) {
    const local = normalizeLocalDigits(
      trimmed.slice(NIGERIA_PHONE_CODE.length),
    );
    if (local && LOCAL_PATTERN.test(local)) {
      return `${NIGERIA_PHONE_CODE}${local}`;
    }
    return null;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('234')) {
    const local = normalizeLocalDigits(digits.slice(3));
    if (local && LOCAL_PATTERN.test(local)) {
      return `${NIGERIA_PHONE_CODE}${local}`;
    }
    return null;
  }

  const local = normalizeLocalDigits(digits);
  if (local && LOCAL_PATTERN.test(local)) {
    return `${NIGERIA_PHONE_CODE}${local}`;
  }

  return null;
}

export function isValidPhoneNumber(
  raw: string | null | undefined,
): boolean {
  return normalizePhoneNumber(raw) !== null;
}

export function normalizePhoneOrThrow(
  raw: string | null | undefined,
): string {
  const normalized = normalizePhoneNumber(raw);
  if (!normalized) {
    throw new BadRequestException('Enter a valid Nigerian phone number.');
  }
  return normalized;
}
