/** Topship item descriptions are picky about comma-separated lists; keep real titles, avoid commas. */
export const TOPSHIP_DESCRIPTION_MAX_LEN = 200;
const DEFAULT_MAX_LEN = TOPSHIP_DESCRIPTION_MAX_LEN;

export function topshipSanitizeDescription(
  raw: string | undefined | null,
  maxLen = DEFAULT_MAX_LEN,
): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/,/g, ' · ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

/** Topship often rejects bare titles for ClothingAndTextile (e.g. "Test Item 6"). */
function topshipAugmentWeakGarmentLine(line: string, product: any): string {
  const trimmed = String(line ?? '').trim();
  const name = String(product?.name ?? '').trim();
  const looksPlaceholder =
    trimmed.length < 14 ||
    /^test\s+item\b/i.test(trimmed) ||
    /^item\s*#?\s*\d+$/i.test(trimmed) ||
    /^product\s*\d+$/i.test(trimmed);
  if (!looksPlaceholder) return topshipSanitizeDescription(trimmed);

  const hints = [
    product?.composition,
    product?.material,
    product?.category?.name,
    product?.color,
    product?.measurement,
  ]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  if (hints.length) {
    const extra = hints.slice(0, 4).join(' · ');
    return (
      topshipSanitizeDescription(`${name || trimmed} · ${extra}`) ||
      topshipSanitizeDescription(trimmed)
    );
  }
  return topshipSanitizeDescription(
    `${trimmed} · clothing and textile rental garment`,
  );
}

/** One product line: brand + name + optional attributes, no commas. */
export function topshipProductDetailLine(product: any): string {
  if (!product) return topshipSanitizeDescription('Item');
  const brand = String(product.brand?.name ?? '').trim();
  const name = String(product.name ?? 'Item').trim();
  const head = [brand, name].filter(Boolean).join(' ');
  const attrs = [
    product.color,
    product.material,
    product.composition,
    product.measurement,
    product.category?.name,
  ]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  const core = attrs.length ? `${head} (${attrs.join(' · ')})` : head;
  const base =
    topshipSanitizeDescription(core) || topshipSanitizeDescription(name);
  return topshipAugmentWeakGarmentLine(base || name, product);
}

/** Several order lines in one shipment row (single Topship item line). */
export function topshipCombinedOrderItemsDescription(
  orderItems: Array<{ product?: any }>,
  maxLen = DEFAULT_MAX_LEN,
  emptyFallback = 'Relisted items',
): string {
  if (!orderItems.length) {
    return topshipSanitizeDescription(emptyFallback, maxLen);
  }
  const parts = orderItems.map((i) => topshipProductDetailLine(i.product));
  const joined = parts.filter(Boolean).join(' · ');
  const out = topshipSanitizeDescription(joined, maxLen);
  return out || topshipSanitizeDescription(emptyFallback, maxLen);
}
