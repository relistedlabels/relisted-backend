/**
 * Admin app (RELISTED-frontend1) mounts under `/admin/{secretId}/...` (see `admin/[id]/layout.tsx`).
 * Email and notification links must include that segment, not `/shipments/:id` at the site root.
 *
 * Configuration (first match wins for base URL):
 * 1. `ADMIN_SHIPMENTS_PAGE_URL` — full URL to the shipments list, e.g. `https://app.com/admin/k340eol21/shipments`
 * 2. `ADMIN_URL` or `FRONTEND_URL` (origin only, no path) + `ADMIN_SECRET_SEGMENT` (same value as frontend `validateAdminId`)
 *
 * When `shipmentId` is passed, `?shipmentId=` is appended so the admin UI can open the detail modal.
 */
export function buildAdminShipmentsPageUrl(options?: {
  shipmentId?: string;
}): string {
  const explicit = process.env.ADMIN_SHIPMENTS_PAGE_URL?.trim();
  let base: string;
  if (explicit) {
    base = explicit.replace(/\/$/, '');
  } else {
    const origin = (
      process.env.ADMIN_URL ||
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      ''
    )
      .trim()
      .replace(/\/$/, '');
    /** Must match `VALID_ADMIN_ID` in RELISTED-frontend1 `src/lib/adminSecretId.ts`. */
    const segment =
      process.env.ADMIN_SECRET_SEGMENT?.trim() || 'k340eol21';
    if (!origin) return '';
    base = `${origin}/admin/${segment}/shipments`;
  }

  const sid = options?.shipmentId?.trim();
  if (!sid) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}shipmentId=${encodeURIComponent(sid)}`;
}
