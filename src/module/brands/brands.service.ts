import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { userEntity } from '../auth/auth.types';
import { Role } from '@prisma/client';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeName(name: string) {
    return name.trim();
  }

  private async assertUniqueName(name: string, excludeId?: string) {
    const normalized = this.normalizeName(name);
    const existing = await this.prisma.brand.findFirst({
      where: {
        name: { equals: normalized, mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('A brand with this name already exists');
    }
  }

  async create(dto: CreateBrandDto, user: userEntity) {
    const name = this.normalizeName(dto.name);
    if (!name) {
      throw new BadRequestException('Brand name is required');
    }

    await this.assertUniqueName(name);

    return this.prisma.brand.create({
      data: {
        name,
        user: {
          connect: { id: user.id },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.brand.findMany({
      include: { user: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAllVisible() {
    return this.prisma.brand.findMany({
      where: { isShopVisible: true },
      orderBy: { name: 'asc' },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.brand.findMany({
      where: { userId },
    });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    return brand;
  }

  async getDeleteImpact(id: string) {
    await this.findOne(id);
    const productCount = await this.prisma.product.count({
      where: { brandId: id },
    });

    return {
      success: true as const,
      data: {
        brandId: id,
        productCount,
      },
    };
  }

  async update(id: string, dto: UpdateBrandDto, user: userEntity) {
    const brand = await this.findOne(id);

    if (brand.userId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('You cannot update this brand');
    }

    if (dto.name !== undefined) {
      const name = this.normalizeName(dto.name);
      if (!name) {
        throw new BadRequestException('Brand name is required');
      }
      await this.assertUniqueName(name, id);
      dto.name = name;
    }

    return this.prisma.brand.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, user: userEntity) {
    const brand = await this.findOne(id);

    if (brand.userId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('You cannot delete this brand');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { brandId: id },
        data: { brandId: null },
      });
      return tx.brand.delete({ where: { id } });
    });
  }
}
