import { Injectable } from '@nestjs/common';
import { connectId, createAttachments } from 'prisma/prisma.utils';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import {
  CreateFavouriteDto,
  CreateProductDto,
  ListProductQuery,
  queryDto,
  UpdateProductStatusDto,
} from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductStatus } from '@prisma/client';
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}
  async create(dto: CreateProductDto, user: userEntity) {
    const daily_Price = dto.originalValue * 0.1;
    const newProduct = await this.prisma.product.create({
      data: {
        name: dto.name,
        subText: dto.subText,
        description: dto.description,
        color: dto.color,
        composition: dto.composition,
        measurement: dto.measurement,
        careInstruction: dto.careInstruction,
        stylingTip: dto.stylingTip,
        warning: dto.warning,
        quantity: dto.quantity,
        originalValue: dto.originalValue,
        dailyPrice: dto.dailyPrice,
        condition: dto.condition,
        careSteps: dto.careSteps,
        curator: connectId(user.id),
        brand: connectId(dto.brandId ?? ''),
        category: connectId(dto?.categoryId ?? ''),
        tag: connectId(dto?.categoryId ?? ''),

        attachments: createAttachments(dto.attachments),
      },
    });
    return {
      message: 'product created successfully',
    };
  }

  async list(query: ListProductQuery) {
    const take = Number(query.count) || 10;
    const page = Number(query.page) || 1;
    const skip = take * (page - 1);
    const orderBy = { createdAt: 'desc' } as const;

    const [list, totalCount] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          productVerified: true,
        },
        skip,
        take,
        orderBy,
        include: {
          brand: true,
          category: true,
          attachments: { include: { uploads: true } },
        },
      }),
      this.prisma.product.count(),
    ]);

    const totalPages = take ? Math.ceil(totalCount / take) : 1;

    const pagination = {
      page,
      totalCount,
      totalPages,
    };

    return { list, pagination };
  }

  async getUserProducts(user: userEntity) {
    const [list, totalCount] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          curatorId: user.id,
        },

        include: {
          brand: true,
          category: true,
          attachments: { include: { uploads: true } },
        },
      }),
      this.prisma.product.count(),
    ]);

    return {
      list,
      totalCount,
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        brand: true,
        category: true,
        curator: {
          select: { id: true, name: true },
        },
        attachments: {
          include: { uploads: true },
        },
        reviews: true,
      },
    });

    if (!product) bad('product not found');

    return product;
  }

  // update product
  async update(id: string, dto: UpdateProductDto, user: userEntity) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) bad('product not found');

    if (!product.isActive) {
      bad('disabled product cannot be edited');
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        ...dto,
        attachments: createAttachments(dto.attachments),
      },
    });

    return {
      message: 'Product updated successfully',
      data: updatedProduct,
    };
  }

  // disable a product
  async updateStatus(
    id: string,
    dto: UpdateProductStatusDto,
    user: userEntity,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) bad('product not found');

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        isActive: dto.isActive,
      },
    });

    return {
      message: dto.isActive
        ? 'Product enabled successfully'
        : 'Product disabled successfully',
      data: updatedProduct,
    };
  }

  // ADMIN VERIFICATION METHOD
  async verifyProduct(id: string, user: userEntity) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) bad('product not found');

    return this.prisma.product.update({
      where: { id },
      data: {
        productVerified: true,
      },
      include: {
        curator: true,
      },
    });
  }
  // add product to favourite

  async createProductFavourite(
    dto: CreateFavouriteDto,

    user: userEntity,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) bad('product not found');

    const existing = await this.prisma.favourite.findFirst({
      where: {
        userId: user.id,
        productId: dto.productId,
      },
    });
    if (existing) bad('Product already in favourites');

    const CreateFavouriteProduct = await this.prisma.favourite.create({
      data: {
        product: connectId(product.id),
        user: connectId(user.id),
      },
    });
    return {
      message: 'Product added to favourites successfully',
      data: CreateFavouriteProduct,
    };
  }
  // list dresser favourite product
  async findAllFavourite(user: userEntity) {
    return await this.prisma.favourite.findMany({
      where: {
        userId: user.id,
      },
      include: { product: { include: { brand: true, category: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  //  UPDATE PRODUCT STATUS
  async updateProductStatus(productId: string, user: userEntity) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) bad('Product with ID ${productId} not found');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        name: 'eeeeeee',
      },
    });

    return updated;
  }

  // filter product
  async findAll(query: queryDto) {
    const { brandId, categoryId, tagId, minPrice, maxPrice, verified } = query;
    const filters: any = {};
    if (brandId) filters.brandId = brandId;
    if (categoryId) filters.categoryId = categoryId;
    if (tagId) filters.tagId = tagId;

    if (minPrice || maxPrice) {
      filters.dailyPrice = {};
      if (minPrice) filters.dailyPrice.gte = Number(minPrice);
      if (maxPrice) filters.dailyPrice.lte = Number(maxPrice);
    }

    return this.prisma.product.findMany({
      where: filters,
      include: {
        brand: true,
        category: true,
        tag: true,
      },
    });
  }

  // DELETE
  async remove(id: string, user: userEntity) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) bad('product not found');

    await this.prisma.product.delete({
      where: { id },
    });

    return {
      message: 'Product deleted successfully',
    };
  }
}
