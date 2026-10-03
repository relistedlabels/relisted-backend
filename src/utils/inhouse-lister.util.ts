/** Default inhouse lister (matches frontend `INHOUSE_USER_ID`). */
export const DEFAULT_INHOUSE_LISTER_USER_ID =
  'c5adb7b9-86bd-4292-90e9-57bbbf3b8083';

function parseInhouseListerAllowlist(): string[] {
  const raw =
    process.env.INHOUSE_LISTER_USER_IDS?.trim() ||
    process.env.CLOSET_INVENTORY_USER_IDS?.trim();

  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [DEFAULT_INHOUSE_LISTER_USER_ID];
}

/** Whether the lister is the inhouse account that manages closet inventory. */
export function isInhouseLister(listerId: string | null | undefined): boolean {
  if (!listerId?.trim()) return false;
  return parseInhouseListerAllowlist().includes(listerId.trim());
}
