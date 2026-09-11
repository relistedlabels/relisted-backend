export const ADMIN_RATE_PREVIEW_TOPSHIP = 'topship';
export const ADMIN_RATE_PREVIEW_SHIPBUBBLE = 'shipbubble';
export const ADMIN_RATE_PREVIEW_CHOWDECK_RELAY = 'chowdeck_relay';
export const ADMIN_RATE_PREVIEW_TSHIP = 'tship';

export const ADMIN_RATE_PREVIEW_PROVIDERS = [
  ADMIN_RATE_PREVIEW_SHIPBUBBLE,
  ADMIN_RATE_PREVIEW_TOPSHIP,
  ADMIN_RATE_PREVIEW_CHOWDECK_RELAY,
  ADMIN_RATE_PREVIEW_TSHIP,
] as const;

export type AdminRatePreviewProvider =
  (typeof ADMIN_RATE_PREVIEW_PROVIDERS)[number];

export function isAdminRatePreviewProvider(
  value: string,
): value is AdminRatePreviewProvider {
  return (ADMIN_RATE_PREVIEW_PROVIDERS as readonly string[]).includes(value);
}
