/** URL-safe closet slug: lowercase, hyphens, max length. */
const MAX_SLUG_LEN = 80;

export function normalizeClosetSlug(input: string): string {
  let s = input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (s.length > MAX_SLUG_LEN) {
    s = s.slice(0, MAX_SLUG_LEN).replace(/-$/, '');
  }
  return s;
}

export function slugFromName(name: string): string {
  const base = normalizeClosetSlug(name);
  return base.length > 0 ? base : 'closet';
}
