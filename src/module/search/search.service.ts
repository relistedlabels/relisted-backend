import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';

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
      const products = await this.prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { brand: { name: { contains: query, mode: 'insensitive' } } },
            { category: { name: { contains: query, mode: 'insensitive' } } },
            { tags: { some: { name: { contains: query, mode: 'insensitive' } } } },
            {color: {in: [query], mode: 'insensitive'}},
            {stylingTip: {in: [query], mode: 'insensitive'}},
            {composition: {in: [query], mode: 'insensitive'}},
          ],
          status: { in: ['AVAILABLE', 'APPROVED'] },
        },
        take: limit,
        include: {
          curator: { select: { name: true } },
          attachments: { include: { uploads: { take: 1 } } },
          tags: true,
        },
      });

      products.forEach((product) => {
        results.push({
          type: 'product',
          id: product.id,
          name: product.name,
          image: product.attachments?.uploads[0]?.url || null,
          lister: product.curator.name,
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
            { profile: { businessInfo: { businessName: { contains: query, mode: 'insensitive' } } } },
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
