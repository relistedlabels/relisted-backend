import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto, user: userEntity) {
    return this.prisma.productCategory.create({
      data: {
        name: dto.name,
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

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);

    return this.prisma.productCategory.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.productCategory.delete({
      where: { id },
    });
  }
}
