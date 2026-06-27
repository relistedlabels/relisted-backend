import { BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';

/**
 * Ensures listing attachment upload ids belong to the acting user (or are
 * already on the product being edited) and are not linked to another product.
 */
export async function assertProductAttachmentUploads(
  prisma: PrismaService,
  uploadIds: string[],
  userId: string,
  productId?: string,
): Promise<void> {
  if (!uploadIds.length) return;

  const uploads = await prisma.upload.findMany({
    where: { id: { in: uploadIds } },
    select: {
      id: true,
      userId: true,
      attachment: { select: { productId: true } },
    },
  });

  const foundIds = new Set(uploads.map((u) => u.id));
  const missingIds = uploadIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw new BadRequestException(
      `The following upload IDs do not exist: ${missingIds.join(', ')}. ` +
        'Please upload files first or use valid upload IDs.',
    );
  }

  for (const upload of uploads) {
    const linkedProductId = upload.attachment?.productId ?? null;

    if (linkedProductId && linkedProductId !== productId) {
      throw new BadRequestException(
        'One or more images are already used on another listing. Please upload new photos.',
      );
    }

    const ownedByUser = upload.userId === userId;
    const onThisProduct = Boolean(
      productId && linkedProductId === productId,
    );
    if (!ownedByUser && !onThisProduct) {
      throw new BadRequestException(
        'One or more uploads do not belong to your account.',
      );
    }
  }
}
