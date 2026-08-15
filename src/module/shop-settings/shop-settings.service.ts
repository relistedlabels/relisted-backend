import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';

@Injectable()
export class ShopSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPrioritizedBrands() {
    const brands = await this.prisma.brand.findMany({
      where: { isShopPrioritized: true },
      orderBy: [{ shopPriorityOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        isShopPrioritized: true,
        shopPriorityOrder: true,
      },
    });

    return {
      success: true as const,
      data: {
        brandIds: brands.map((brand) => brand.id),
        brands,
      },
    };
  }

  async setPrioritizedBrands(brandIds: string[]) {
    if (!Array.isArray(brandIds)) {
      throw new BadRequestException('brandIds must be an array');
    }

    const uniqueIds = [...new Set(brandIds.filter((id) => typeof id === 'string'))];
    if (uniqueIds.length > 0) {
      const count = await this.prisma.brand.count({
        where: { id: { in: uniqueIds } },
      });
      if (count !== uniqueIds.length) {
        throw new BadRequestException('One or more brand IDs are invalid');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.brand.updateMany({
        data: { isShopPrioritized: false, shopPriorityOrder: null },
      });
      for (let i = 0; i < uniqueIds.length; i++) {
        await tx.brand.update({
          where: { id: uniqueIds[i] },
          data: { isShopPrioritized: true, shopPriorityOrder: i },
        });
      }
    });

    return this.getPrioritizedBrands();
  }
}
