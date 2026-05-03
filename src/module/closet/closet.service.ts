import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { userEntity } from '../auth/auth.types';
import { CreateClosetDto } from './dto/create-closet.dto';
import { UpdateClosetDto } from './dto/update-closet.dto';
import { slugFromName, normalizeClosetSlug } from './closet-slug.util';
import { Prisma, ProductStatus } from '@prisma/client';

@Injectable()
export class ClosetService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public closet lists / counts: include live shop rows and sold showcase rows
   * (sold resale is inactive but still shown on closet + drops surfaces).
   */
  private closetPublicGalleryProductWhere(): Prisma.ProductWhereInput {
    return {
      OR: [
        {
          isActive: true,
          status: {
            in: [
              ProductStatus.AVAILABLE,
              ProductStatus.APPROVED,
              ProductStatus.RENTED,
            ],
          },
        },
        { status: ProductStatus.SOLD },
      ],
    };
  }

  private async allocateUniqueSlug(desired: string): Promise<string> {
    const base =
      normalizeClosetSlug(desired).length > 0
        ? normalizeClosetSlug(desired)
        : 'closet';
    let slug = base;
    let n = 0;
    while (
      await this.prisma.closet.findUnique({
        where: { slug },
        select: { id: true },
      })
    ) {
      n += 1;
      slug = `${base}-${n}`;
    }
    return slug;
  }

  async create(dto: CreateClosetDto, user: userEntity) {
    const rawSlug = dto.slug?.trim()
      ? normalizeClosetSlug(dto.slug)
      : slugFromName(dto.name);
    const slug = await this.allocateUniqueSlug(rawSlug);

    try {
      const closet = await this.prisma.closet.create({
        data: {
          ownerId: user.id,
          name: dto.name.trim(),
          slug,
          description: dto.description?.trim() || null,
          imageUrl: dto.imageUrl?.trim() || null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return {
        success: true,
        message: 'Closet created successfully',
        data: closet,
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Slug already in use');
      }
      throw e;
    }
  }

  async listMine(user: userEntity) {
    const closets = await this.prisma.closet.findMany({
      where: { ownerId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { products: true } },
      },
    });
    return {
      success: true,
      message: 'Closets retrieved successfully',
      data: closets.map((c) => {
        const { _count, ...rest } = c;
        return { ...rest, productCount: _count.products };
      }),
    };
  }

  async findOneForOwner(id: string, user: userEntity) {
    const closet = await this.prisma.closet.findFirst({
      where: { id, ownerId: user.id },
      include: {
        _count: { select: { products: true } },
      },
    });
    if (!closet) {
      throw new NotFoundException('Closet not found');
    }
    const { _count, ...rest } = closet;
    return {
      success: true,
      message: 'Closet retrieved successfully',
      data: {
        ...rest,
        productCount: _count.products,
      },
    };
  }

  async update(id: string, dto: UpdateClosetDto, user: userEntity) {
    const existing = await this.prisma.closet.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) {
      throw new NotFoundException('Closet not found');
    }

    let slug = existing.slug;
    if (dto.slug !== undefined && dto.slug.trim() !== '') {
      slug = normalizeClosetSlug(dto.slug);
      if (!slug) {
        throw new BadRequestException('Invalid slug');
      }
      if (slug !== existing.slug) {
        const taken = await this.prisma.closet.findFirst({
          where: { slug, NOT: { id } },
          select: { id: true },
        });
        if (taken) {
          slug = await this.allocateUniqueSlug(slug);
        }
      }
    }

    const data: Prisma.ClosetUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined || dto.name !== undefined) data.slug = slug;
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.imageUrl !== undefined) {
      data.imageUrl = dto.imageUrl?.trim() || null;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (Object.keys(data).length === 0) {
      return {
        success: true,
        message: 'No changes',
        data: existing,
      };
    }

    const closet = await this.prisma.closet.update({
      where: { id },
      data,
    });
    return {
      success: true,
      message: 'Closet updated successfully',
      data: closet,
    };
  }

  /** Soft-delete: deactivate only (products keep closetId for owner dashboard). */
  async deactivate(id: string, user: userEntity) {
    const existing = await this.prisma.closet.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) {
      throw new NotFoundException('Closet not found');
    }
    const closet = await this.prisma.closet.update({
      where: { id },
      data: { isActive: false },
    });
    return {
      success: true,
      message: 'Closet deactivated',
      data: closet,
    };
  }

  /** Returns closet id for active public closets; throws NotFound. */
  async getActivePublicClosetBySlug(slug: string) {
    const closet = await this.prisma.closet.findUnique({
      where: { slug },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            profile: { select: { avatar: true } },
          },
        },
        _count: {
          select: {
            products: {
              where: this.closetPublicGalleryProductWhere(),
            },
          },
        },
      },
    });
    if (!closet || !closet.isActive) {
      throw new NotFoundException('Closet not found');
    }
    return {
      success: true,
      message: 'Closet retrieved successfully',
      data: {
        id: closet.id,
        name: closet.name,
        slug: closet.slug,
        description: closet.description,
        imageUrl: closet.imageUrl,
        owner: {
          id: closet.owner.id,
          name: closet.owner.name,
          avatar: closet.owner.profile?.avatar ?? null,
        },
        publicProductCount: closet._count.products,
      },
    };
  }

  /** Active closets with at least one public-facing row (live or sold showcase). */
  async listPublicForMarketing(limit: number) {
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const galleryWhere = this.closetPublicGalleryProductWhere();

    const closets = await this.prisma.closet.findMany({
      where: {
        isActive: true,
        products: { some: galleryWhere },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: safeLimit,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            profile: { select: { avatar: true } },
          },
        },
        _count: {
          select: {
            products: { where: galleryWhere },
          },
        },
      },
    });

    return {
      success: true,
      message: 'Public closets retrieved successfully',
      data: closets.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: c.imageUrl,
        owner: {
          id: c.owner.id,
          name: c.owner.name,
          avatar: c.owner.profile?.avatar ?? null,
        },
        publicProductCount: c._count.products,
      })),
    };
  }

  async assertClosetAssignable(closetId: string, curatorId: string) {
    const closet = await this.prisma.closet.findFirst({
      where: { id: closetId, ownerId: curatorId, isActive: true },
      select: { id: true },
    });
    if (!closet) {
      throw new BadRequestException(
        'Invalid or inactive closet for this account',
      );
    }
  }
}
