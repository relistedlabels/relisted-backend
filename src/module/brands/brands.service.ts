import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBrandDto, user: userEntity) {
    return this.prisma.brand.create({
      data: {
        name: dto.name,
        user: {
          connect: { id: user.id },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.brand.findMany({
      include: { user: true },
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

  async update(id: string, dto: UpdateBrandDto, userId: string) {
    const brand = await this.findOne(id);

    if (brand.userId !== userId) {
      throw new ForbiddenException('You cannot update this brand');
    }

    return this.prisma.brand.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    const brand = await this.findOne(id);

    if (brand.userId !== userId) {
      throw new ForbiddenException('You cannot delete this brand');
    }

    return this.prisma.brand.delete({
      where: { id },
    });
  }
}
