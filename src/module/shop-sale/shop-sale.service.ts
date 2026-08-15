import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../services/prisma/prisma.service';
import { MailService } from '../../services/mail/mail.service';
import { PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY } from '../../utils/product-attachment-upload-order';
import { CreateShopSaleDto } from './dto/create-shop-sale.dto';
import { UpdateShopSaleDto } from './dto/update-shop-sale.dto';
import { RegisterShopSaleInterestDto } from './dto/register-shop-sale-interest.dto';
import {
  getShopSalePhase,
  serializeShopSalePublic,
  slugifySaleName,
} from './shop-sale.util';
import { applyProductListFilters } from '../product/product-list-filters.util';

@Injectable()
export class ShopSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  private async ensureUniqueSlug(base: string, excludeId?: string) {
    let slug = base || 'sale';
    let suffix = 0;
    while (true) {
      const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
      const existing = await this.prisma.shopSale.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing || existing.id === excludeId) return candidate;
      suffix++;
    }
  }

  private parseDate(value: string, field: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return d;
  }

  private serializeAdminSale(
    sale: Prisma.ShopSaleGetPayload<{
      include: {
        _count: { select: { products: true; interests: true } };
      };
    }>,
  ) {
    return {
      ...sale,
      phase: getShopSalePhase(sale),
      productCount: sale._count.products,
      waitlistCount: sale._count.interests,
      startsAt: sale.startsAt.toISOString(),
      endsAt: sale.endsAt.toISOString(),
      earliestDeliveryAt: sale.earliestDeliveryAt?.toISOString() ?? null,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
    };
  }

  async listForAdmin(page = 1, limit = 20) {
    const pageSafe = Math.max(1, page);
    const limitSafe = Math.min(100, Math.max(1, limit));
    const skip = (pageSafe - 1) * limitSafe;

    const [total, sales] = await this.prisma.$transaction([
      this.prisma.shopSale.count(),
      this.prisma.shopSale.findMany({
        skip,
        take: limitSafe,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { products: true, interests: true } },
        },
      }),
    ]);

    return {
      success: true as const,
      data: {
        sales: sales.map((s) => this.serializeAdminSale(s)),
        total,
        page: pageSafe,
        totalPages: Math.ceil(total / limitSafe) || 1,
      },
    };
  }

  async getForAdmin(saleId: string) {
    const sale = await this.prisma.shopSale.findUnique({
      where: { id: saleId },
      include: {
        _count: { select: { products: true, interests: true } },
        products: {
          orderBy: { createdAt: 'desc' },
          select: {
            productId: true,
            product: {
              select: {
                id: true,
                name: true,
                status: true,
                listingType: true,
                dailyPrice: true,
                resalePrice: true,
                curator: { select: { id: true, name: true, email: true } },
                brand: { select: { id: true, name: true } },
                attachments: {
                  select: {
                    uploads: {
                      take: 1,
                      orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const products = sale.products.map((row) => ({
      id: row.product.id,
      name: row.product.name,
      status: row.product.status,
      listingType: row.product.listingType,
      dailyPrice: row.product.dailyPrice,
      resalePrice: row.product.resalePrice,
      listerName: row.product.curator.name,
      listerEmail: row.product.curator.email,
      brandName: row.product.brand?.name ?? null,
      imageUrl: row.product.attachments?.uploads?.[0]?.url ?? null,
    }));

    return {
      success: true as const,
      data: {
        ...this.serializeAdminSale(sale),
        products,
      },
    };
  }

  async create(dto: CreateShopSaleDto) {
    const startsAt = this.parseDate(dto.startsAt, 'startsAt');
    const endsAt = this.parseDate(dto.endsAt, 'endsAt');
    if (endsAt <= startsAt) {
      throw new BadRequestException('End date must be after start date');
    }

    const baseSlug = slugifySaleName(dto.slug?.trim() || dto.internalName);
    const slug = await this.ensureUniqueSlug(baseSlug);

    const sale = await this.prisma.shopSale.create({
      data: {
        slug,
        internalName: dto.internalName.trim(),
        headline: dto.headline.trim(),
        subheadline: dto.subheadline?.trim() || null,
        shopTitle: dto.shopTitle.trim(),
        shopDescription: dto.shopDescription?.trim() || null,
        preSaleMessage: dto.preSaleMessage?.trim() || null,
        startsAt,
        endsAt,
        earliestDeliveryAt: dto.earliestDeliveryAt
          ? this.parseDate(dto.earliestDeliveryAt, 'earliestDeliveryAt')
          : null,
        isEnabled: dto.isEnabled ?? false,
        bannerEnabled: dto.bannerEnabled ?? true,
        waitlistEnabled: dto.waitlistEnabled ?? true,
        shopAccessEnabled: dto.shopAccessEnabled ?? true,
        showCountdown: dto.showCountdown ?? true,
        notifyEmailSubject: dto.notifyEmailSubject?.trim() || null,
        notifyEmailBody: dto.notifyEmailBody?.trim() || null,
      },
      include: {
        _count: { select: { products: true, interests: true } },
      },
    });

    return {
      success: true as const,
      data: this.serializeAdminSale(sale),
    };
  }

  async update(saleId: string, dto: UpdateShopSaleDto) {
    const existing = await this.prisma.shopSale.findUnique({
      where: { id: saleId },
    });
    if (!existing) throw new NotFoundException('Sale not found');

    const startsAt = dto.startsAt
      ? this.parseDate(dto.startsAt, 'startsAt')
      : existing.startsAt;
    const endsAt = dto.endsAt
      ? this.parseDate(dto.endsAt, 'endsAt')
      : existing.endsAt;
    if (endsAt <= startsAt) {
      throw new BadRequestException('End date must be after start date');
    }

    let slug = existing.slug;
    if (dto.slug !== undefined) {
      slug = await this.ensureUniqueSlug(
        slugifySaleName(dto.slug.trim() || existing.internalName),
        saleId,
      );
    }

    const sale = await this.prisma.shopSale.update({
      where: { id: saleId },
      data: {
        ...(dto.internalName !== undefined && {
          internalName: dto.internalName.trim(),
        }),
        ...(dto.slug !== undefined && { slug }),
        ...(dto.headline !== undefined && { headline: dto.headline.trim() }),
        ...(dto.subheadline !== undefined && {
          subheadline: dto.subheadline?.trim() || null,
        }),
        ...(dto.shopTitle !== undefined && {
          shopTitle: dto.shopTitle.trim(),
        }),
        ...(dto.shopDescription !== undefined && {
          shopDescription: dto.shopDescription?.trim() || null,
        }),
        ...(dto.preSaleMessage !== undefined && {
          preSaleMessage: dto.preSaleMessage?.trim() || null,
        }),
        ...(dto.startsAt !== undefined && { startsAt }),
        ...(dto.endsAt !== undefined && { endsAt }),
        ...(dto.earliestDeliveryAt !== undefined && {
          earliestDeliveryAt: dto.earliestDeliveryAt
            ? this.parseDate(dto.earliestDeliveryAt, 'earliestDeliveryAt')
            : null,
        }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.bannerEnabled !== undefined && {
          bannerEnabled: dto.bannerEnabled,
        }),
        ...(dto.waitlistEnabled !== undefined && {
          waitlistEnabled: dto.waitlistEnabled,
        }),
        ...(dto.shopAccessEnabled !== undefined && {
          shopAccessEnabled: dto.shopAccessEnabled,
        }),
        ...(dto.showCountdown !== undefined && {
          showCountdown: dto.showCountdown,
        }),
        ...(dto.notifyEmailSubject !== undefined && {
          notifyEmailSubject: dto.notifyEmailSubject?.trim() || null,
        }),
        ...(dto.notifyEmailBody !== undefined && {
          notifyEmailBody: dto.notifyEmailBody?.trim() || null,
        }),
      },
      include: {
        _count: { select: { products: true, interests: true } },
      },
    });

    return {
      success: true as const,
      data: this.serializeAdminSale(sale),
    };
  }

  async setEnabled(saleId: string, isEnabled: boolean) {
    return this.update(saleId, { isEnabled });
  }

  async setProducts(saleId: string, productIds: string[]) {
    const sale = await this.prisma.shopSale.findUnique({
      where: { id: saleId },
      select: { id: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const uniqueIds = [...new Set(productIds.filter(Boolean))];
    if (uniqueIds.length > 0) {
      const count = await this.prisma.product.count({
        where: { id: { in: uniqueIds } },
      });
      if (count !== uniqueIds.length) {
        throw new BadRequestException('One or more listings were not found');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.shopSaleProduct.deleteMany({ where: { saleId } });
      if (uniqueIds.length > 0) {
        await tx.shopSaleProduct.createMany({
          data: uniqueIds.map((productId) => ({ saleId, productId })),
          skipDuplicates: true,
        });
      }
    });

    return this.getForAdmin(saleId);
  }

  private buildPickerWhere(params: {
    search?: string;
    category?: string | string[];
    brand?: string | string[];
    tags?: string;
    listingType?: string | string[];
    curatorId?: string | string[];
    color?: string;
    size?: string;
    condition?: string;
    material?: string;
    minPrice?: number;
    maxPrice?: number;
    inCloset?: boolean;
  }): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {
      status: {
        in: [
          ProductStatus.APPROVED,
          ProductStatus.AVAILABLE,
          ProductStatus.RENTED,
        ],
      },
      isActive: true,
    };

    applyProductListFilters(where, {
      category: params.category,
      brand: params.brand,
      tags: params.tags,
      listingType: params.listingType,
      curatorId: params.curatorId,
      color: params.color,
      size: params.size,
      condition: params.condition,
      material: params.material,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      inCloset: params.inCloset,
    });

    const q = params.search?.trim();
    if (q) {
      const searchFilter: Prisma.ProductWhereInput = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { curator: { name: { contains: q, mode: 'insensitive' } } },
          { curator: { email: { contains: q, mode: 'insensitive' } } },
          { brand: { name: { contains: q, mode: 'insensitive' } } },
          { category: { name: { contains: q, mode: 'insensitive' } } },
          {
            tags: {
              some: { name: { contains: q, mode: 'insensitive' } },
            },
          },
        ],
      };
      if (!where.AND) where.AND = [];
      (where.AND as Prisma.ProductWhereInput[]).push(searchFilter);
    }

    return where;
  }

  async listProductIdsForPicker(params: {
    search?: string;
    category?: string | string[];
    brand?: string | string[];
    tags?: string;
    listingType?: string | string[];
    curatorId?: string | string[];
    color?: string;
    size?: string;
    condition?: string;
    material?: string;
    minPrice?: number;
    maxPrice?: number;
    inCloset?: boolean;
  }) {
    const where = this.buildPickerWhere(params);
    const total = await this.prisma.product.count({ where });
    const maxIds = 5000;
    if (total > maxIds) {
      throw new BadRequestException(
        `Too many matching listings (${total}). Narrow your filters to ${maxIds} or fewer.`,
      );
    }

    const rows = await this.prisma.product.findMany({
      where,
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      success: true as const,
      data: {
        productIds: rows.map((row) => row.id),
        total,
      },
    };
  }

  async searchProductsForPicker(params: {
    search?: string;
    page?: number;
    limit?: number;
    saleId?: string;
    category?: string | string[];
    brand?: string | string[];
    tags?: string;
    listingType?: string | string[];
    curatorId?: string | string[];
    color?: string;
    size?: string;
    condition?: string;
    material?: string;
    minPrice?: number;
    maxPrice?: number;
    inCloset?: boolean;
    prioritizeIds?: string[];
  }) {
    const pageSafe = Math.max(1, params.page ?? 1);
    const limitSafe = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (pageSafe - 1) * limitSafe;
    const where = this.buildPickerWhere(params);
    const prioritizeIds = [
      ...new Set(
        (params.prioritizeIds ?? []).filter((id) => typeof id === 'string'),
      ),
    ];
    const prioritizeOrder = new Map(
      prioritizeIds.map((id, index) => [id, index]),
    );

    const productSelect = {
      id: true,
      name: true,
      status: true,
      listingType: true,
      dailyPrice: true,
      resalePrice: true,
      color: true,
      measurement: true,
      condition: true,
      material: true,
      closetId: true,
      curator: { select: { id: true, name: true, email: true } },
      brand: { select: { name: true } },
      category: { select: { name: true } },
      tags: { select: { name: true } },
      attachments: {
        select: {
          uploads: {
            take: 1,
            orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
            select: { url: true },
          },
        },
      },
      shopSales: params.saleId
        ? { where: { saleId: params.saleId }, select: { saleId: true } }
        : false,
    } as const;

    let products: Array<
      Awaited<
        ReturnType<
          typeof this.prisma.product.findMany<{ select: typeof productSelect }>
        >
      >[number]
    >;

    const total = await this.prisma.product.count({ where });

    if (prioritizeIds.length > 0 && pageSafe === 1) {
      const pinnedRows = await this.prisma.product.findMany({
        where: {
          AND: [where, { id: { in: prioritizeIds } }],
        },
        select: productSelect,
      });
      pinnedRows.sort(
        (a, b) =>
          (prioritizeOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (prioritizeOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );

      const pinnedIds = pinnedRows.map((row) => row.id);
      const othersNeeded = Math.max(0, limitSafe - pinnedRows.length);
      const othersRows =
        othersNeeded > 0
          ? await this.prisma.product.findMany({
              where: {
                AND: [where, { id: { notIn: pinnedIds } }],
              },
              take: othersNeeded,
              orderBy: { updatedAt: 'desc' },
              select: productSelect,
            })
          : [];

      products = [...pinnedRows, ...othersRows];
    } else {
      products = await this.prisma.product.findMany({
        where,
        skip,
        take: limitSafe,
        orderBy: { updatedAt: 'desc' },
        select: productSelect,
      });
    }

    return {
      success: true as const,
      data: {
        products: products.map((p) => this.mapPickerProductRow(p)),
        total,
        page: pageSafe,
        totalPages: Math.ceil(total / limitSafe) || 1,
      },
    };
  }

  private mapPickerProductRow(
    p: {
      id: string;
      name: string;
      status: string;
      listingType: string;
      dailyPrice: number | null;
      resalePrice: number | null;
      color: string;
      measurement: string;
      condition: string;
      material: string | null;
      closetId: string | null;
      curator: { name: string; email: string };
      brand: { name: string } | null;
      category: { name: string } | null;
      tags: { name: string }[];
      attachments: { uploads: { url: string }[] } | null;
      shopSales?: { saleId: string }[] | false;
    },
  ) {
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      listingType: p.listingType,
      dailyPrice: p.dailyPrice,
      resalePrice: p.resalePrice,
      color: p.color,
      size: p.measurement,
      condition: p.condition,
      material: p.material ?? null,
      tagNames: p.tags.map((tag) => tag.name),
      inCloset: Boolean(p.closetId),
      listerName: p.curator.name,
      listerEmail: p.curator.email,
      brandName: p.brand?.name ?? null,
      categoryName: p.category?.name ?? null,
      imageUrl: p.attachments?.uploads?.[0]?.url ?? null,
      inSale: Array.isArray(p.shopSales) ? p.shopSales.length > 0 : false,
    };
  }

  async getProductIdsForSale(saleId: string): Promise<string[]> {
    const rows = await this.prisma.shopSaleProduct.findMany({
      where: { saleId },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  }

  async resolveSaleBySlug(slug: string) {
    const sale = await this.prisma.shopSale.findUnique({
      where: { slug },
      include: { _count: { select: { products: true } } },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  /** Featured sale: enabled, banner on, not ended. Prefer live, then upcoming. */
  async getFeaturedSale() {
    const now = new Date();
    const candidates = await this.prisma.shopSale.findMany({
      where: {
        isEnabled: true,
        bannerEnabled: true,
        endsAt: { gte: now },
      },
      include: { _count: { select: { products: true } } },
      orderBy: { startsAt: 'asc' },
    });

    const live = candidates.find((s) => getShopSalePhase(s, now) === 'live');
    if (live) {
      return serializeShopSalePublic(
        { ...live, productCount: live._count.products },
        now,
      );
    }

    const upcoming = candidates.find(
      (s) => getShopSalePhase(s, now) === 'upcoming',
    );
    if (upcoming) {
      return serializeShopSalePublic(
        { ...upcoming, productCount: upcoming._count.products },
        now,
      );
    }

    return null;
  }

  /** Enabled sales that are upcoming or live (for header nav). */
  async listActiveSalesForNav() {
    const now = new Date();
    const rows = await this.prisma.shopSale.findMany({
      where: {
        isEnabled: true,
        endsAt: { gte: now },
      },
      include: { _count: { select: { products: true } } },
      orderBy: { startsAt: 'asc' },
    });

    return rows
      .filter((sale) => {
        const phase = getShopSalePhase(sale, now);
        return phase === 'upcoming' || phase === 'live';
      })
      .map((sale) =>
        serializeShopSalePublic(
          { ...sale, productCount: sale._count.products },
          now,
        ),
      );
  }

  async getPublicBySlug(slug: string) {
    const sale = await this.resolveSaleBySlug(slug);
    return {
      success: true as const,
      data: serializeShopSalePublic({
        ...sale,
        productCount: sale._count.products,
      }),
    };
  }

  private buildShopUrl(sale: {
    slug: string;
    shopTitle: string;
    shopDescription: string | null;
  }): string {
    const base = (process.env.FRONTEND_URL || 'https://relisted.ng').replace(
      /\/$/,
      '',
    );
    const params = new URLSearchParams();
    params.set('sale', sale.slug);
    params.set('title', sale.shopTitle);
    if (sale.shopDescription?.trim()) {
      params.set('description', sale.shopDescription.trim());
    }
    return `${base}/shop?${params.toString()}`;
  }

  async listWaitlistForAdmin(saleId: string, page = 1, limit = 20) {
    const sale = await this.prisma.shopSale.findUnique({
      where: { id: saleId },
      select: { id: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const pageSafe = Math.max(1, page);
    const limitSafe = Math.min(100, Math.max(1, limit));
    const skip = (pageSafe - 1) * limitSafe;

    const [total, entries] = await this.prisma.$transaction([
      this.prisma.shopSaleInterest.count({ where: { saleId } }),
      this.prisma.shopSaleInterest.findMany({
        where: { saleId },
        skip,
        take: limitSafe,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      success: true as const,
      data: {
        entries: entries.map((e) => ({
          id: e.id,
          email: e.email,
          joinedAt: e.createdAt.toISOString(),
          userName: e.user?.name ?? null,
        })),
        total,
        pagination: {
          total,
          page: pageSafe,
          limit: limitSafe,
          pages: Math.ceil(total / limitSafe) || 1,
        },
      },
    };
  }

  async notifyWaitlistForAdmin(saleId: string) {
    const sale = await this.prisma.shopSale.findUnique({
      where: { id: saleId },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const rows = await this.prisma.shopSaleInterest.findMany({
      where: { saleId },
      select: { email: true },
    });
    const emails = rows.map((r) => r.email);
    if (emails.length === 0) {
      return {
        success: true as const,
        data: { sent: 0, failed: [] as { email: string; error: string }[] },
      };
    }

    const shopUrl = this.buildShopUrl(sale);
    const subject =
      sale.notifyEmailSubject?.trim() || `${sale.headline} is live`;
    const result = await this.mailService.sendShopSaleLiveMailBatch(
      emails,
      shopUrl,
      {
        headline: sale.headline,
        subject,
        body: sale.notifyEmailBody,
      },
    );

    return { success: true as const, data: result };
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private async resolveUserIdFromOptionalAuth(
    authorization: string | undefined,
    normalizedEmail: string,
  ): Promise<string | undefined> {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    const token = authorization.slice('Bearer '.length).trim();
    if (!token) return undefined;
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        v?: number;
      }>(token, { secret: process.env.JWT_SECRET });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, tokenVersion: true },
      });
      if (!user) return undefined;
      if (user.tokenVersion !== (payload.v ?? 0)) return undefined;
      if (user.email.toLowerCase() !== normalizedEmail) return undefined;
      return user.id;
    } catch {
      return undefined;
    }
  }

  async registerInterest(
    slug: string,
    dto: RegisterShopSaleInterestDto,
    authorization?: string,
  ) {
    const sale = await this.resolveSaleBySlug(slug);
    if (!sale.waitlistEnabled) {
      throw new BadRequestException('Waitlist is not open for this sale');
    }

    const email = this.normalizeEmail(dto.email);
    const userId = await this.resolveUserIdFromOptionalAuth(
      authorization,
      email,
    );

    const existing = await this.prisma.shopSaleInterest.findUnique({
      where: { saleId_email: { saleId: sale.id, email } },
    });

    if (existing) {
      if (userId && !existing.userId) {
        await this.prisma.shopSaleInterest.update({
          where: { id: existing.id },
          data: { userId },
        });
      }
      return {
        success: true,
        alreadySubscribed: true,
        message: 'You are already on the notify list for this sale.',
      };
    }

    await this.prisma.shopSaleInterest.create({
      data: { saleId: sale.id, email, userId },
    });

    return {
      success: true,
      alreadySubscribed: false,
      message: 'Thanks. We will email you when this sale is live.',
    };
  }
}
