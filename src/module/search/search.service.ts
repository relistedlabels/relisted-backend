import { Injectable } from '@nestjs/common';
import { buildProductKeywordSearchWhere } from '../product/product-keyword-search.util';
import { LIVE_SHOP_STATUSES } from '../product/product-list-scope.util';
import { PrismaService } from '../../services/prisma/prisma.service';
import { PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY } from '../../utils/product-attachment-upload-order';

const STAGING_CURATOR_ID =
  process.env.STAGING_INTERNAL_CURATOR_ID ??
  '7d172d18-daad-46cd-ab6d-8d8af28c0b16';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(query: string, type: string = 'all', limit: number = 10) {
    if (!query) {
      return { success: true, data: { results: [] } };
    }

    const results: any[] = [];

    // Search Products
    if (type === 'all' || type === 'product') {
      const keywordWhere = buildProductKeywordSearchWhere(query);
      const products = keywordWhere
        ? await this.prisma.product.findMany({
        where: {
          AND: [
            keywordWhere,
            { closetId: null },
            { isActive: true },
            { status: { in: LIVE_SHOP_STATUSES } },
            { NOT: { curatorId: STAGING_CURATOR_ID } },
          ],
        },
        take: limit,
        include: {
          curator: { select: { name: true } },
          attachments: {
            include: {
              uploads: {
                orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                take: 1,
              },
            },
          },
          tags: true,
        },
      })
        : [];

      products.forEach((product) => {
        results.push({
          type: 'product',
          id: product.id,
          name: product.name,
          image: product.attachments?.uploads[0]?.url || null,
          lister: product.curator.name,
          curatorId: product.curatorId,
          price: product.dailyPrice,
          tags: product.tags.map((t: any) => t.name),
        });
      });
    }

    // Search Brands
    if (type === 'all' || type === 'brand') {
      const brands = await this.prisma.brand.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' },
        },
        take: limit,
      });

      brands.forEach((brand) => {
        results.push({
          type: 'brand',
          id: brand.id,
          name: brand.name,
          // image: brand.logo, // Assuming brand has logo in future or adapt schema
        });
      });
    }

    // Search Listers
    if (type === 'all' || type === 'lister') {
      const listers = await this.prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            {
              profile: {
                businessInfo: {
                  businessName: { contains: query, mode: 'insensitive' },
                },
              },
            },
          ],
          role: 'LISTER',
        },
        take: limit,
        include: {
          profile: {
            include: {
              avatarUpload: { select: { url: true } },
              businessInfo: { select: { businessName: true } },
            },
          },
        },
      });

      listers.forEach((lister) => {
        results.push({
          type: 'lister',
          id: lister.id,
          name: lister.profile?.businessInfo?.businessName || lister.name,
          avatar: lister.profile?.avatarUpload?.url || null,
        });
      });
    }

    // Slice to limit if 'all' type returned too many combined results
    const finalResults = type === 'all' ? results.slice(0, limit) : results;

    return {
      success: true,
      data: {
        results: finalResults,
      },
    };
  }
}
