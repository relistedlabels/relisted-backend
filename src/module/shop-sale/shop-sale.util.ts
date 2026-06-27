import type { ShopSale } from '@prisma/client';

export type ShopSalePhase = 'off' | 'upcoming' | 'live' | 'ended';

export function slugifySaleName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function getShopSalePhase(
  sale: Pick<ShopSale, 'isEnabled' | 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): ShopSalePhase {
  if (!sale.isEnabled) return 'off';
  const t = now.getTime();
  if (t < sale.startsAt.getTime()) return 'upcoming';
  if (t > sale.endsAt.getTime()) return 'ended';
  return 'live';
}

export function serializeShopSalePublic(
  sale: ShopSale & { productCount?: number },
  now: Date = new Date(),
) {
  const phase = getShopSalePhase(sale, now);
  return {
    id: sale.id,
    slug: sale.slug,
    headline: sale.headline,
    subheadline: sale.subheadline,
    shopTitle: sale.shopTitle,
    shopDescription: sale.shopDescription,
    preSaleMessage: sale.preSaleMessage,
    startsAt: sale.startsAt.toISOString(),
    endsAt: sale.endsAt.toISOString(),
    earliestDeliveryAt: sale.earliestDeliveryAt?.toISOString() ?? null,
    bannerEnabled: sale.bannerEnabled,
    waitlistEnabled: sale.waitlistEnabled,
    shopAccessEnabled: sale.shopAccessEnabled,
    showCountdown: sale.showCountdown,
    phase,
    productCount: sale.productCount ?? 0,
  };
}

const DEFAULT_NOTIFY_EMAIL_BODY = `Hi there,

The sale you signed up for is now live on Relisted.

Browse the collection and shop your picks before they are gone. This is a limited-time drop, so don't wait too long.

Happy shopping,
Team Relisted`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain-text admin copy to safe HTML paragraphs for the waitlist email. */
export function formatShopSaleNotifyEmailBodyHtml(body?: string | null): string {
  const source = body?.trim() || DEFAULT_NOTIFY_EMAIL_BODY;
  return source
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const withBreaks = escapeHtml(paragraph).replace(/\n/g, '<br>');
      return `<p>${withBreaks}</p>`;
    })
    .join('\n');
}
