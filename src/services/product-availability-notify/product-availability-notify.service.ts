import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ProductAvailabilityNotifyService {
  private readonly logger = new Logger(ProductAvailabilityNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async subscribe(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, curatorId: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (product.curatorId === userId) {
      throw new BadRequestException(
        'You cannot subscribe to your own listing.',
      );
    }
    if (product.status !== ProductStatus.RENTED) {
      throw new BadRequestException(
        'Notify is only available while this item is out on rental.',
      );
    }

    await this.prisma.productAvailabilityNotification.upsert({
      where: {
        productId_userId: { productId, userId },
      },
      create: { productId, userId },
      update: {},
    });

    return {
      success: true,
      message:
        'You will be emailed at your account address when this item is available to rent again.',
    };
  }

  /**
   * Call after product is set back to AVAILABLE (return complete, order cancelled, etc.).
   * Sends one email per subscriber and clears rows for this product.
   */
  async notifyWatchersProductAvailable(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { name: true, status: true },
    });
    if (!product || product.status !== ProductStatus.AVAILABLE) {
      return;
    }

    const watchers = await this.prisma.productAvailabilityNotification.findMany(
      {
        where: { productId },
        include: {
          user: { select: { email: true, name: true } },
        },
      },
    );

    if (watchers.length === 0) {
      return;
    }

    const baseUrl = (process.env.CLIENT_URL || '').replace(/\/$/, '');
    const productUrl = `${baseUrl}/shop/product-details/${productId}`;

    for (const w of watchers) {
      try {
        await this.mailService.sendProductAvailableNotifyEmail({
          email: w.user.email,
          userName: w.user.name || 'there',
          productName: product.name,
          productUrl: productUrl || '#',
        });
      } catch (err) {
        this.logger.error(
          `Failed to send availability email to ${w.user.email} for product ${productId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    await this.prisma.productAvailabilityNotification.deleteMany({
      where: { productId },
    });
  }
}
