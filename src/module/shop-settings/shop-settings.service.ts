import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../services/prisma/prisma.service';
import {
  ADMIN_ACTIVE_LISTING_STATUSES,
} from '../product/product-list-scope.util';

const BRAND_SELECT = {
  id: true,
  name: true,
  isShopVisible: true,
  isShopPrioritized: true,
  shopPriorityOrder: true,
} as const;

export type BrandRemovalWarning = {
  brandId: string;
  brandName: string;
  rentedSkipped: number;
};

@Injectable()
export class ShopSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getVisibleBrands() {
    const brands = await this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      select: BRAND_SELECT,
    });

    return {
      success: true as const,
      data: {
        visibleBrandIds: brands
          .filter((brand) => brand.isShopVisible)
          .map((brand) => brand.id),
        brands,
      },
    };
  }

  async setVisibleBrands(brandIds: string[]) {
    if (!Array.isArray(brandIds)) {
      throw new BadRequestException('brandIds must be an array');
    }

    const uniqueIds = [
      ...new Set(brandIds.filter((id) => typeof id === 'string' && id.trim())),
    ];

    if (uniqueIds.length > 0) {
      const count = await this.prisma.brand.count({
        where: { id: { in: uniqueIds } },
      });
      if (count !== uniqueIds.length) {
        throw new BadRequestException('One or more brand IDs are invalid');
      }
    }

    const currentlyVisible = await this.prisma.brand.findMany({
      where: { isShopVisible: true },
      select: { id: true, name: true },
    });
    const currentSet = new Set(currentlyVisible.map((brand) => brand.id));
    const nextSet = new Set(uniqueIds);
    const removedIds = [...currentSet].filter((id) => !nextSet.has(id));
    const addedIds = uniqueIds.filter((id) => !currentSet.has(id));
    const warnings: BrandRemovalWarning[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.brand.updateMany({ data: { isShopVisible: false } });

      if (uniqueIds.length > 0) {
        await tx.brand.updateMany({
          where: { id: { in: uniqueIds } },
          data: { isShopVisible: true },
        });
      }

      if (removedIds.length > 0) {
        await tx.brand.updateMany({
          where: { id: { in: removedIds } },
          data: { isShopPrioritized: false, shopPriorityOrder: null },
        });

        for (const brandId of removedIds) {
          const brandName =
            currentlyVisible.find((brand) => brand.id === brandId)?.name ??
            'Brand';

          const rentedSkipped = await tx.product.count({
            where: { brandId, status: ProductStatus.RENTED },
          });

          if (rentedSkipped > 0) {
            warnings.push({ brandId, brandName, rentedSkipped });
          }

          await tx.product.updateMany({
            where: {
              brandId,
              status: { in: [...ADMIN_ACTIVE_LISTING_STATUSES, ProductStatus.UNAVAILABLE] },
            },
            data: {
              status: ProductStatus.UNAVAILABLE,
              isActive: false,
              deactivatedByBrandRemoval: true,
            },
          });

          await tx.product.updateMany({
            where: {
              brandId,
              status: ProductStatus.PENDING,
            },
            data: {
              isActive: false,
              deactivatedByBrandRemoval: true,
            },
          });
        }
      }

      if (addedIds.length > 0) {
        await tx.product.updateMany({
          where: {
            brandId: { in: addedIds },
            deactivatedByBrandRemoval: true,
            status: {
              in: [
                ...ADMIN_ACTIVE_LISTING_STATUSES,
                ProductStatus.UNAVAILABLE,
              ],
            },
          },
          data: {
            status: ProductStatus.AVAILABLE,
            isActive: true,
            deactivatedByBrandRemoval: false,
          },
        });

        await tx.product.updateMany({
          where: {
            brandId: { in: addedIds },
            deactivatedByBrandRemoval: true,
            status: ProductStatus.PENDING,
          },
          data: {
            isActive: true,
            deactivatedByBrandRemoval: false,
          },
        });
      }
    });

    const result = await this.getVisibleBrands();
    return {
      ...result,
      warnings,
    };
  }

  async getPrioritizedBrands() {
    const brands = await this.prisma.brand.findMany({
      where: { isShopPrioritized: true },
      orderBy: [{ shopPriorityOrder: 'asc' }, { name: 'asc' }],
      select: BRAND_SELECT,
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

    const uniqueIds = [
      ...new Set(brandIds.filter((id) => typeof id === 'string' && id.trim())),
    ];

    if (uniqueIds.length > 0) {
      const visibleCount = await this.prisma.brand.count({
        where: {
          id: { in: uniqueIds },
          isShopVisible: true,
        },
      });
      if (visibleCount !== uniqueIds.length) {
        throw new BadRequestException(
          'Only site-visible brands can be prioritized',
        );
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

  async assertBrandIsVisible(brandId: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { id: true, isShopVisible: true },
    });

    if (!brand) {
      throw new BadRequestException(
        'Invalid brand selected. Please choose a brand from the list.',
      );
    }

    if (!brand.isShopVisible) {
      throw new BadRequestException(
        'This brand is not available for new listings. Please choose another brand.',
      );
    }
  }
}
