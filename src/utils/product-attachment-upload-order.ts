import type { Prisma } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';

/** Nested `uploads` order for product attachments (hero first). */
export const PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY: Prisma.UploadOrderByWithRelationInput[] =
  [{ displayOrder: 'asc' }, { createdAt: 'asc' }];

/** Message / chat file attachments: chronological order. */
export const MESSAGE_CHAT_UPLOADS_ORDER_BY: Prisma.UploadOrderByWithRelationInput[] =
  [{ createdAt: 'asc' }];

/** Same include shape as product.create return payload, with ordered uploads. */
export const productDetailIncludeOrdered: Prisma.ProductInclude = {
  attachments: {
    include: {
      uploads: {
        orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
      },
    },
  },
  brand: true,
  category: true,
  tags: true,
  closet: {
    select: { id: true, name: true, slug: true, imageUrl: true },
  },
};

/**
 * After linking uploads to a product, set displayOrder from the client id list
 * so reads are stable (Postgres does not preserve connect order).
 */
export async function setProductAttachmentUploadDisplayOrder(
  prisma: PrismaService,
  orderedUploadIds: string[],
): Promise<void> {
  if (!orderedUploadIds.length) return;
  await prisma.$transaction(
    orderedUploadIds.map((id, index) =>
      prisma.upload.update({
        where: { id },
        data: { displayOrder: index },
      }),
    ),
  );
}

/** Hero URL from in-memory uploads (e.g. cart line) using displayOrder when present. */
export function firstProductAttachmentImageUrlFromUploads(
  uploads:
    | Array<{ url?: string | null; displayOrder?: number | null; id?: string }>
    | null
    | undefined,
): string | null {
  if (!uploads?.length) return null;
  const sorted = [...uploads].sort((a, b) => {
    const ao = typeof a.displayOrder === 'number' ? a.displayOrder : 0;
    const bo = typeof b.displayOrder === 'number' ? b.displayOrder : 0;
    if (ao !== bo) return ao - bo;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
  const raw = sorted[0]?.url;
  const s = raw != null ? String(raw).trim() : '';
  return s.length > 0 ? s : null;
}
