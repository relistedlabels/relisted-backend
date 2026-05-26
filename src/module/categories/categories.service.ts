import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { userEntity } from '../auth/auth.types';
import { randomUUID } from 'crypto';

import { UploadService } from '../upload/upload.service';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async create(dto: CreateCategoryDto, user: userEntity, file?: any) {
    let imageUrl = dto.imageUrl;

    if (file) {
      const upload = await this.uploadService.uploadFile(randomUUID(), file, user);
      imageUrl = upload.url;
    }

    return this.prisma.productCategory.create({
      data: {
        name: dto.name,
        imageUrl,
        user: {
          connect: { id: user.id },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.productCategory.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.productCategory.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, user: userEntity, file?: any) {
    await this.findOne(id);

    let imageUrl = dto.imageUrl;
    if (file) {
      const upload = await this.uploadService.uploadFile(randomUUID(), file, user);
      imageUrl = upload.url;
    }

    return this.prisma.productCategory.update({
      where: { id },
      data: {
        ...dto,
        ...(imageUrl && { imageUrl }),
      },
    });
  }
  

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      });
      return tx.productCategory.delete({ where: { id } });
    });
  }
}
