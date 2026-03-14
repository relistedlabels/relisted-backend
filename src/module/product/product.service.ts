// import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
// import { connectId, createAttachments } from 'prisma/prisma.utils';
// import { PrismaService } from 'src/services/prisma/prisma.service';
// import { bad } from 'src/utils/error';
// import { userEntity } from '../auth/auth.types';
// import {
//   CreateFavouriteDto,
//   CreateProductDto,
//   ListProductQuery,
//   queryDto,
//   UpdateProductStatusDto,
// } from './dto/create-product.dto';
// import { UpdateProductDto } from './dto/update-product.dto';
// import { ProductStatus } from '@prisma/client';
// export class ProductService {
//   constructor(private readonly prisma: PrismaService) {}


// // async create(dto: CreateProductDto, user: userEntity) {
// //   console.log('📦 CREATE PRODUCT DTO:', dto);
// //   console.log('👤 USER:', user);

// //   if (!dto) {
// //     throw new BadRequestException('Product data is missing');
// //   }

// //   try {
// //     // 🔍 DEBUG RELATION IDS
// //     console.log(" brandId:", dto.brandId)
// //     console.log(' categoryId:', dto.categoryId);
// //     console.log('tagId:', dto.tagId);

// //     // 🔍 DEBUG REQUIRED FIELDS
// //     console.log('Required fields check:', {
// //       name: dto.name,
// //       subText: dto.subText,
// //       description: dto.description,
// //       condition: dto.condition,
// //       measurement: dto.measurement,
// //       color: dto.color,
// //       originalValue: dto.originalValue,
// //       careInstruction: dto.careInstruction,
// //       careSteps: dto.careSteps,
// //       stylingTip: dto.stylingTip,
// //     });

// //     const daily_Price = dto.originalValue
// //       ? Math.floor(dto.originalValue * 0.1)
// //       : 0;

// //     console.log(' Calculated daily price:', daily_Price);

// //     // 🔍 DEBUG ATTACHMENTS
// //     console.log(
// //       '📎 Attachments length:',
// //       dto.attachments?.length ?? 0,
// //     );

// //     const attachments = await this.prisma.upload.findMany({
// //   where: { id: { in: dto.attachments } }
// // });

// // console.log("jjjjjj",attachments)
// // if (attachments.length !== dto.attachments.length) {
// //   throw new BadRequestException('One or more attachments not found');
// // }


// //     const newProduct = await this.prisma.product.create({
// //       data: {
// //         name: dto.name ?? '',
// //         subText: dto.subText ?? '',
// //         description: dto.description ?? '',
// //         condition: dto.condition ?? '',
// //         measurement: dto.measurement ?? '',
// //         color: dto.color ?? '',
// //         originalValue: dto.originalValue ?? 0,
// //         dailyPrice: dto.dailyPrice ?? daily_Price,
// //         careInstruction: dto.careInstruction ?? '',
// //         careSteps: dto.careSteps ?? '',
// //         stylingTip: dto.stylingTip ?? '',

// //         quantity: dto.quantity ?? 0,

// //         curator: {
// //           connect: { id: user.id },
// //         },

// //         brand: dto.brandId
// //           ? { connect: { id: dto.brandId } }
// //           : undefined,

// //         category: dto.categoryId
// //           ? { connect: { id: dto.categoryId } }
// //           : undefined,

// //         tag: dto.tagId
// //           ? { connect: { id: dto.tagId } }
// //           : undefined,

// //         attachments:
// //           dto.attachments && dto.attachments.length > 0
// //             ? createAttachments(dto.attachments)
// //             : undefined,
// //       },
// //     });


// //     console.log('✅ PRODUCT CREATED:', newProduct);

// //     return {
// //       message: 'Product created successfully',
// //       product: newProduct,
// //     };
// //   } catch (error) {
// //     console.error('❌ PRODUCT CREATION FAILED');
// //     console.error(error);

// //     throw new InternalServerErrorException(
// //       error instanceof Error ? error.message : 'Unknown error',
// //     );
// //   }
// // }


//  private createAttachments(uploads?: string[]) {
//     if (!uploads || uploads.length === 0) return undefined;

//     return {
//       create: {
//         uploads: {
//           connect: uploads.map((id) => ({ id })),
//         },
//       },
//     };
//   }

// async create(dto: CreateProductDto, user:userEntity) {
//   console.log('📦 CREATE PRODUCT DTO:', dto);

//   try {
//     // Calculate daily price
//     const dailyPrice = dto.dailyPrice || (dto.originalValue ? Math.floor(dto.originalValue * 0.1) : 0);

//     // Validate attachments if provided
//     if (dto.attachments?.length) {
//       const uploads = await this.prisma.upload.findMany({
//         where: { id: { in: dto.attachments } },
//       });

//       if (uploads.length !== dto.attachments.length) {
//         throw new BadRequestException('One or more attachments not found');
//       }

//       const alreadyAttached = uploads.filter(u => u.attachmentId !== null);
//       if (alreadyAttached.length > 0) {
//         throw new BadRequestException('One or more uploads are already attached to a product');
//       }
//     }

//     // Create product with attachments in one operation
//     const newProduct = await this.prisma.product.create({
//       data: {
//         name: dto.name,
//         subText: dto.subText,
//         description: dto.description,
//         condition: dto.condition,
//         measurement: dto.measurement,
//         color: dto.color,
//         originalValue: dto.originalValue || 0,
//         dailyPrice: dailyPrice,
//         careInstruction: dto.careInstruction,
//         careSteps: dto.careSteps,
//         stylingTip: dto.stylingTip,
//         quantity: dto.quantity || 1,
//         composition: dto.composition || '',
//         warning: dto.warning || '',
//         curatorId: user.id,
//         ...(dto.brandId && { brandId: dto.brandId }),
//         ...(dto.categoryId && { categoryId: dto.categoryId }),
//         ...(dto.tagId && { tagId: dto.tagId }),
//         ...(dto.attachments?.length && {
//           attachments: {
//             create: {
//               uploads: {
//                 connect: dto.attachments.map(id => ({ id })),
//               },
//             },
//           },
//         }),
//       },
//       include: {
//         attachments: {
//           include: {
//             uploads: true,
//           },
//         },
//         brand: true,
//         category: true,
//         tag: true,
//         curator: {
//           select: {
//             id: true,
//             name: true,
//             email: true,
//           },
//         },
//       },
//     });

//     console.log('✅ PRODUCT CREATED WITH ATTACHMENTS');

//     return {
//       message: 'Product created successfully',
//       product: newProduct,
//     };
//   } catch (error) {
//     console.error('❌ ERROR:', error);
    
//     if (error.code === 'P2002') {
//       throw new BadRequestException('Product already exists');
//     }
    
//     if (error.code === 'P2025') {
//       throw new BadRequestException('Referenced record not found');
//     }
    
//     throw new InternalServerErrorException('Failed to create product');
//   }
// }

//   async list(query: ListProductQuery) {
//     const take = Number(query.count) || 10;
//     const page = Number(query.page) || 1;
//     const skip = take * (page - 1);
//     const orderBy = { createdAt: 'desc' } as const;

//     const [list, totalCount] = await Promise.all([
//       this.prisma.product.findMany({
//         where: {
//           productVerified: true,
//         },
//         skip,
//         take,
//         orderBy,
//         include: {
//           brand: true,
//           category: true,
//           attachments: { include: { uploads: true } },
//         },
//       }),
//       this.prisma.product.count(),
//     ]);

//     const totalPages = take ? Math.ceil(totalCount / take) : 1;

//     const pagination = {
//       page,
//       totalCount,
//       totalPages,
//     };

//     return { list, pagination };
//   }

//   async getUserProducts(user: userEntity) {
//     const [list, totalCount] = await Promise.all([
//       this.prisma.product.findMany({
//         where: {
//           curatorId: user.id,
//         },

//         include: {
//           brand: true,
//           category: true,
//           attachments: { include: { uploads: true } },
//         },
//       }),
//       this.prisma.product.count(),
//     ]);

//     return {
//       list,
//       totalCount,
//     };
//   }

//   async findOne(id: string) {
//     const product = await this.prisma.product.findUnique({
//       where: { id },
//       include: {
//         brand: true,
//         category: true,
//         curator: {
//           select: { id: true, name: true },
//         },
//         attachments: {
//           include: { uploads: true },
//         },
//         reviews: true,
//       },
//     });

//     if (!product) bad('product not found');

//     return product;
//   }

//   // update product
//   async update(id: string, dto: UpdateProductDto, user: userEntity) {
//     const product = await this.prisma.product.findUnique({
//       where: { id },
//     });

//     if (!product) bad('product not found');

//     if (!product.isActive) {
//       bad('disabled product cannot be edited');
//     }

//     const updatedProduct = await this.prisma.product.update({
//       where: { id },
//       data: {
//         ...dto,
//         attachments: createAttachments(dto.attachments),
//       },
//     });

//     return {
//       message: 'Product updated successfully',
//       data: updatedProduct,
//     };
//   }

//   // disable a product
//   async updateStatus(
//     id: string,
//     dto: UpdateProductStatusDto,
//     user: userEntity,
//   ) {
//     const product = await this.prisma.product.findUnique({
//       where: { id },
//     });

//     if (!product) bad('product not found');

//     const updatedProduct = await this.prisma.product.update({
//       where: { id },
//       data: {
//         isActive: dto.isActive,
//       },
//     });

//     return {
//       message: dto.isActive
//         ? 'Product enabled successfully'
//         : 'Product disabled successfully',
//       data: updatedProduct,
//     };
//   }

//   // ADMIN VERIFICATION METHOD
//   async verifyProduct(id: string, user: userEntity) {
//     const product = await this.prisma.product.findUnique({
//       where: { id },
//     });

//     if (!product) bad('product not found');

//     return this.prisma.product.update({
//       where: { id },
//       data: {
//         productVerified: true,
//       },
//       include: {
//         curator: true,
//       },
//     });
//   }
//   // add product to favourite

//   async createProductFavourite(
//     dto: CreateFavouriteDto,

//     user: userEntity,
//   ) {
//     const product = await this.prisma.product.findUnique({
//       where: { id: dto.productId },
//     });
//     if (!product) bad('product not found');

//     const existing = await this.prisma.favourite.findFirst({
//       where: {
//         userId: user.id,
//         productId: dto.productId,
//       },
//     });
//     if (existing) bad('Product already in favourites');

//     const CreateFavouriteProduct = await this.prisma.favourite.create({
//       data: {
//         product: connectId(product.id),
//         user: connectId(user.id),
//       },
//     });
//     return {
//       message: 'Product added to favourites successfully',
//       data: CreateFavouriteProduct,
//     };
//   }
//   // list dresser favourite product
//   async findAllFavourite(user: userEntity) {
//     return await this.prisma.favourite.findMany({
//       where: {
//         userId: user.id,
//       },
//       include: { product: { include: { brand: true, category: true } } },
//       orderBy: { createdAt: 'desc' },
//     });
//   }

//   //  UPDATE PRODUCT STATUS
//   async updateProductStatus(productId: string, user: userEntity) {
//     const product = await this.prisma.product.findUnique({
//       where: { id: productId },
//     });

//     if (!product) bad('Product with ID ${productId} not found');

//     const updated = await this.prisma.product.update({
//       where: { id: productId },
//       data: {
//         name: 'eeeeeee',
//       },
//     });

//     return updated;
//   }

//   // filter product
//   async findAll(query: queryDto) {
//     const { brandId, categoryId, tagId, minPrice, maxPrice, verified } = query;
//     const filters: any = {};
//     if (brandId) filters.brandId = brandId;
//     if (categoryId) filters.categoryId = categoryId;
//     if (tagId) filters.tagId = tagId;

//     if (minPrice || maxPrice) {
//       filters.dailyPrice = {};
//       if (minPrice) filters.dailyPrice.gte = Number(minPrice);
//       if (maxPrice) filters.dailyPrice.lte = Number(maxPrice);
//     }

//     return this.prisma.product.findMany({
//       where: filters,
//       include: {
//         brand: true,
//         category: true,
//         tag: true,
//       },
//     });
//   }

//   // DELETE
//   async remove(id: string, user: userEntity) {
//     const product = await this.prisma.product.findUnique({
//       where: { id },
//     });

//     if (!product) bad('product not found');

//     await this.prisma.product.delete({
//       where: { id },
//     });

//     return {
//       message: 'Product deleted successfully',
//     };
//   }
// }



import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { connectId } from 'prisma/prisma.utils'; // REMOVE createAttachments from import
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

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  
  async create(dto: CreateProductDto, user: userEntity) {
    try {
      const categoryId = dto.categoryId?.trim() || undefined;
      const brandId = dto.brandId?.trim() || undefined;
      let tagIdsToConnect: string[] = [];
      if (dto.tagids) {
        const incomingTags = Array.isArray(dto.tagids) ? dto.tagids : [dto.tagids];
        tagIdsToConnect = incomingTags.map(id => typeof id === 'string' ? id.trim() : '').filter(id => id.length > 0);
        
        if (tagIdsToConnect.length > 0) {
          const existingTags = await this.prisma.tag.findMany({
            where: { id: { in: tagIdsToConnect } },
            select: { id: true },
          });

          if (existingTags.length !== tagIdsToConnect.length) {
            throw new BadRequestException(
              'One or more invalid tags selected. Please choose valid tags.',
            );
          }
        }
      }
      if (categoryId) {
        const categoryExists = await this.prisma.productCategory.findUnique({
          where: { id: categoryId },
          select: { id: true },
        });
        if (!categoryExists) {
          throw new BadRequestException(
            'Invalid category selected. Please choose a category from the list.',
          );
        }
      }
      if (brandId) {
        const brandExists = await this.prisma.brand.findUnique({
          where: { id: brandId },
          select: { id: true },
        });
        if (!brandExists) {
          throw new BadRequestException(
            'Invalid brand selected. Please choose a brand from the list.',
          );
        }
      }

      if (dto.attachments?.length) {
        const existingUploads = await this.prisma.upload.findMany({
          where: {
            id: { in: dto.attachments },
          },
          select: { id: true },
        });

        const existingIds = existingUploads.map((upload) => upload.id);
        const missingIds = dto.attachments.filter(
          (id) => !existingIds.includes(id),
        );

        if (missingIds.length > 0) {
          throw new BadRequestException(
            `The following upload IDs do not exist: ${missingIds.join(', ')}. ` +
              'Please upload files first or use valid upload IDs.',
          );
        }
      }

      const newProduct = await this.prisma.product.create({
        data: {
          name: dto.name,
          subText: dto.subText,
          description: dto.description,
          condition: dto.condition,
          measurement: dto.measurement,
          color: dto.color,
          originalValue: dto.originalValue || 0,
          collateralPrice: dto.collateralPrice,
          dailyPrice: dto.dailyPrice,
          careInstruction: dto.careInstruction,
          careSteps: dto.careSteps ?? '',
          stylingTip: dto.stylingTip,
          quantity: dto.quantity || 1,
          composition: dto.composition || '',
          warning: dto.warning || '',
          curatorId: user.id,
          status: ProductStatus.PENDING, // Products start in pending state
          productVerified: false,
          ...(brandId && { brandId }),
          ...(categoryId && { categoryId }),
          ...(tagIdsToConnect.length > 0 && {
            tags: {
              connect: tagIdsToConnect.map(id => ({ id }))
            }
          }),
        
        // Only create attachments if there are valid uploads
        ...(dto.attachments?.length && {
          attachments: {
            create: {
              uploads: {
                connect: dto.attachments.map(id => ({ id }))
              }
            }
          }
        })
      },
      include: {
        attachments: {
          include: {
            uploads: true
          }
        }
      }
    });

    return {
      success: true, 
      message: 'Product created successfully',
      product: newProduct,
    };
  } catch (error) {
    console.error('ERROR creating product:', error);
     throw error;
   
  
  }
}
 
// only show approved and available products
  async list(query: ListProductQuery) {
    try {
      const page = Number(query.page) || 1;
      const limit = Number(query.count) || 10;
      const skip = (page - 1) * limit;

      // Fetch products and total count in parallel
      // Only show products that are APPROVED and AVAILABLE
      const [products, total] = await Promise.all([
        this.prisma.product.findMany({
          where: {
            status: 'APPROVED',
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            brand: true,
            category: true,
            tags: true,
            attachments: {
              include: {
                uploads: {
                  select: { id: true, url: true },
                },
              },
            },
          },
        }),
        this.prisma.product.count({
          where: {
            status: 'APPROVED',
          },
        }),
      ]);

      // Calculate pagination metadata
      const totalPages = Math.ceil(total / limit);
      const hasNext = page < totalPages;
      const hasPrevious = page > 1;

      return {
        success: true,
        message: 'Products retrieved successfully',
        data: {
          products,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrevious,
          },
        },
      };
    } catch (error) {
      console.error('List products error:', error);
      throw new InternalServerErrorException('Failed to retrieve products');
    }
  }


  // Get pending products for admin review
  async getPendingProducts(query: ListProductQuery) {
    try {
      const page = Number(query.page) || 1;
      const limit = Number(query.count) || 10;
      const skip = (page - 1) * limit;

      // Query for pending products - include products that are either:
      // 1. Status is PENDING, OR
      // 2. Not verified (legacy products created before status system)
      const [products, total] = await Promise.all([
        this.prisma.product.findMany({
          where: {
            OR: [
              { status: ProductStatus.PENDING },
              // Fallback: include unverified products (created before status system)
              { productVerified: false, status: { not: ProductStatus.APPROVED } },
            ],
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            brand: true,
            category: true,
            tags: true,
            curator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            attachments: {
              include: {
                uploads: {
                  select: { id: true, url: true },
                },
              },
            },
          },
        }),
        this.prisma.product.count({
          where: {
            OR: [
              { status: ProductStatus.PENDING },
              // Fallback: include unverified products (created before status system)
              { productVerified: false, status: { not: ProductStatus.APPROVED } },
            ],
          },
        }),
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNext = page < totalPages;
      const hasPrevious = page > 1;

      return {
        success: true,
        message: 'Pending products retrieved successfully',
        data: {
          products,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrevious,
          },
        },
      };
    } catch (error) {
      console.error('Get pending products error:', error);
      throw new InternalServerErrorException('Failed to retrieve pending products');
    }
  }

  // Get user all products with their statuses (for dashboard)
  async getUserProducts(user: userEntity) {
    try {
      const products = await this.prisma.product.findMany({
        where: {
          curatorId: user.id,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          subText: true,
          status: true,
          productVerified: true,
          isActive: true,
          rejectionComment: true,
          dailyPrice: true,
          originalValue: true,
          quantity: true,
          createdAt: true,
          updatedAt: true,
          attachments: {
            include: {
              uploads: {
                select: { id: true, url: true },
              },
            },
          },
          brand: {
            select: { id: true, name: true },
          },
          category: {
            select: { id: true, name: true },
          },
          tags: {
            select: { id: true, name: true },
          },
        },
      });

      return {
        success: true,
        message: 'User products retrieved successfully',
        data: products,
        count: products.length,
      };
    } catch (error) {
      console.error('Get user products error:', error);
      throw new InternalServerErrorException('Failed to retrieve user products');
    }
  }

  // Get product statistics
  async getProductStatistics(user: userEntity) {
    try {
      const userRecord = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });

      const isAdmin = userRecord?.role === 'ADMIN';

      // Build where clause based on role
      const whereClause = isAdmin
        ? {} // Admins see all products
        : { curatorId: user.id }; // Listers see only their products

      // Product select structure (consistent with getUserProducts)
      const productSelect = {
        id: true,
        name: true,
        subText: true,
        status: true,
        productVerified: true,
        isActive: true,
        rejectionComment: true,
        dailyPrice: true,
        originalValue: true,
        quantity: true,
        createdAt: true,
        updatedAt: true,
        attachments: {
          include: {
            uploads: {
              select: { id: true, url: true },
            },
          },
        },
        brand: {
          select: { id: true, name: true },
        },
        category: {
          select: { id: true, name: true },
        },
        tags: {
          select: { id: true, name: true },
        },
      };

      const [
        totalProductsData,
        approvedProductsData,
        rejectedProductsData,
        pendingProductsData,
        activeProductsData,
      ] = await Promise.all([
        // Total products
        Promise.all([
          this.prisma.product.count({
            where: whereClause,
          }),
          this.prisma.product.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            select: productSelect,
          }),
        ]),
        // Approved products (status is AVAILABLE or UNAVAILABLE, and productVerified is true)
        Promise.all([
          this.prisma.product.count({
            where: {
              ...whereClause,
              productVerified: true,
              OR: [
                { status: ProductStatus.AVAILABLE },
                { status: ProductStatus.UNAVAILABLE },
              ],
            },
          }),
          this.prisma.product.findMany({
            where: {
              ...whereClause,
              productVerified: true,
              OR: [
                { status: ProductStatus.AVAILABLE },
                { status: ProductStatus.UNAVAILABLE },
              ],
            },
            orderBy: { createdAt: 'desc' },
            select: productSelect,
          }),
        ]),
        // Rejected products
        Promise.all([
          this.prisma.product.count({
            where: {
              ...whereClause,
              status: ProductStatus.REJECTED,
            },
          }),
          this.prisma.product.findMany({
            where: {
              ...whereClause,
              status: ProductStatus.REJECTED,
            },
            orderBy: { createdAt: 'desc' },
            select: productSelect,
          }),
        ]),
        // Pending products
        Promise.all([
          this.prisma.product.count({
            where: {
              ...whereClause,
              status: ProductStatus.PENDING,
            },
          }),
          this.prisma.product.findMany({
            where: {
              ...whereClause,
              status: ProductStatus.PENDING,
            },
            orderBy: { createdAt: 'desc' },
            select: productSelect,
          }),
        ]),
        // Active products (AVAILABLE status with isActive: true)
        Promise.all([
          this.prisma.product.count({
            where: {
              ...whereClause,
              status: ProductStatus.AVAILABLE,
              isActive: true,
              productVerified: true,
            },
          }),
          this.prisma.product.findMany({
            where: {
              ...whereClause,
              status: ProductStatus.AVAILABLE,
              isActive: true,
              productVerified: true,
            },
            orderBy: { createdAt: 'desc' },
            select: productSelect,
          }),
        ]),
      ]);

      return {
        success: true,
        message: 'Product statistics retrieved successfully',
        data: {
          getTotalProducts: {
            count: totalProductsData[0],
            products: totalProductsData[1],
          },
          getApprovedProducts: {
            count: approvedProductsData[0],
            products: approvedProductsData[1],
          },
          getRejectedProducts: {
            count: rejectedProductsData[0],
            products: rejectedProductsData[1],
          },
          getPendingProducts: {
            count: pendingProductsData[0],
            products: pendingProductsData[1],
          },
          getActiveProducts: {
            count: activeProductsData[0],
            products: activeProductsData[1],
          },
        },
      };
    } catch (error) {
      console.error('Get product statistics error:', error);
      throw new InternalServerErrorException('Failed to retrieve product statistics');
    }
  }

    
  //  Get product by ID with detailed information
   
  async findOne(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          attachments: {
            include: {
              uploads: { select: { id: true, url: true } },
            },
          },
        },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      if (!product.isActive) {
        throw new BadRequestException('This product is currently unavailable');
      }

      return {
        success: true,
        message: 'Product retrieved successfully',
        data: product,
      };
    } catch (error) {
      console.error('Find one product error:', error);
      
      if (error instanceof NotFoundException || 
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to retrieve product');
    }
  }
  



  // Approve product (Admin only) - replaces verifyProduct
  async approveProduct(id: string, user: userEntity) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      if (product.status === ProductStatus.APPROVED) {
        throw new BadRequestException('Product is already approved');
      }

      if (product.status === ProductStatus.REJECTED) {
        throw new BadRequestException('Cannot approve a rejected product. Please contact support.');
      }

      const approvedProduct = await this.prisma.product.update({
        where: { id },
        data: {
          status: ProductStatus.AVAILABLE, // Set to AVAILABLE when approved (so it shows in listings)
          productVerified: true,
          isActive: true, // Automatically set to active when approved
          rejectionComment: null, // Clear any previous rejection comment
        },
        include: {
          curator: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return {
        success: true,
        message: 'Product approved successfully',
        data: approvedProduct,
      };
    } catch (error) {
      console.error('Approve product error:', error);
      
      if (error instanceof ForbiddenException || 
          error instanceof NotFoundException || 
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to approve product');
    }
  }

  // Reject product with comment (Admin only)
  async rejectProduct(id: string, rejectionComment: string, user: userEntity) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      if (product.status === ProductStatus.REJECTED) {
        throw new BadRequestException('Product is already rejected');
      }

      if (product.status === ProductStatus.APPROVED) {
        throw new BadRequestException('Cannot reject an approved product. Use delete instead.');
      }

      const rejectedProduct = await this.prisma.product.update({
        where: { id },
        data: {
          status: ProductStatus.REJECTED,
          productVerified: false,
          rejectionComment: rejectionComment,
          isActive: false, // Deactivate rejected products
        },
        include: {
          curator: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return {
        success: true,
        message: 'Product rejected successfully',
        data: rejectedProduct,
      };
    } catch (error) {
      console.error('Reject product error:', error);
      
      if (error instanceof ForbiddenException || 
          error instanceof NotFoundException || 
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to reject product');
    }
  }


  // Toggle product availability (only for approved products)
  // Users can deactivate their approved products manually
  async toggleAvailability(id: string, isAvailable: boolean, user: userEntity) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        select: {
          id: true,
          curatorId: true,
          status: true,
        },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      // Check permissions: user must be owner OR admin
      const userRecord = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });

      const isOwner = product.curatorId === user.id;
      const isAdmin = userRecord?.role === 'ADMIN';

      if (!isOwner && !isAdmin) {
        throw new ForbiddenException('You can only toggle availability of your own products');
      }

      // Only AVAILABLE/UNAVAILABLE products can have availability toggled
      // (These are products that have been approved)
      if (
        product.status !== ProductStatus.AVAILABLE &&
        product.status !== ProductStatus.UNAVAILABLE
      ) {
        throw new BadRequestException(
          'Only approved products can have their availability toggled. Current status: ' +
            product.status,
        );
      }

      const updatedProduct = await this.prisma.product.update({
        where: { id },
        data: {
          status: isAvailable ? ProductStatus.AVAILABLE : ProductStatus.UNAVAILABLE,
          isActive: isAvailable,
        },
      });

      return {
        success: true,
        message: isAvailable 
          ? 'Product marked as available' 
          : 'Product marked as unavailable',
        data: updatedProduct,
      };
    } catch (error) {
      console.error('Toggle availability error:', error);
      
      if (error instanceof NotFoundException || 
          error instanceof ForbiddenException ||
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to toggle product availability');
    }
  }

  // Update product (users can edit own, admins can edit any)
  async update(id: string, dto: UpdateProductDto, user: userEntity) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        select: {
          id: true,
          curatorId: true,
          status: true,
        },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      // Check permissions: user must be owner OR admin
      const userRecord = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });

      const isOwner = product.curatorId === user.id;
      const isAdmin = userRecord?.role === 'ADMIN';

      if (!isOwner && !isAdmin) {
        throw new ForbiddenException('You can only edit your own products');
      }

      // Users can only edit pending or rejected products (to resubmit)
      // Admins can edit any product
      if (!isAdmin && product.status !== ProductStatus.PENDING && product.status !== ProductStatus.REJECTED) {
        throw new BadRequestException(
          'You can only edit products that are pending or rejected. Current status: ' + product.status
        );
      }

      // If editing a rejected product, reset to pending
      const updateData: any = { ...dto };
      if (product.status === ProductStatus.REJECTED && !isAdmin) {
        updateData.status = ProductStatus.PENDING;
        updateData.rejectionComment = null;
      }

      if (dto.attachments) {
        updateData.attachments = {
          upsert: {
            create: { uploads: { connect: dto.attachments.map((id: string) => ({ id })) } },
            update: { uploads: { set: dto.attachments.map((id: string) => ({ id })) } },
          }
        };
      }

      if (dto.tagids) {
        const incomingTags = Array.isArray(dto.tagids) ? dto.tagids : [dto.tagids];
        const tagsToSet = incomingTags.map((id: string) => typeof id === 'string' ? id.trim() : '').filter((id: string) => id.length > 0);
        updateData.tags = {
          set: tagsToSet.map((id: string) => ({ id }))
        };
        delete updateData.tagids;
      }

      const updatedProduct = await this.prisma.product.update({
        where: { id },
        data: updateData,
        include: {
          attachments: {
            include: {
              uploads: true,
            },
          },
          brand: true,
          category: true,
          tags: true,
        },
      });

      return {
        success: true,
        message: 'Product updated successfully',
        data: updatedProduct,
      };
    } catch (error) {
      console.error('Update product error:', error);
      
      if (error instanceof NotFoundException || 
          error instanceof ForbiddenException ||
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to update product');
    }
  }
  

  // product favourite
  async createProductFavourite(dto: CreateFavouriteDto, user: userEntity) {
    try {
      // Check if product exists
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${dto.productId} not found`);
      }

      if (!product.isActive) {
        throw new BadRequestException('Cannot add inactive product to favourites');
      }

      // Check if already in favourites
      const existingFavourite = await this.prisma.favourite.findUnique({
        where: {
          userId_productId: {
            userId: user.id,
            productId: dto.productId,
          },
        },
      });

      if (existingFavourite) {
        throw new BadRequestException('Product already in favourites');
      }

      const favourite = await this.prisma.favourite.create({
        data: {
          userId: user.id,
          productId: dto.productId,
        },
        include: {
          product: {
          
          },
        },
      });

      return {
        success: true,
        message: 'Product added to favourites successfully',
        data: favourite,
      };
    } catch (error) {
      console.error('Create favourite error:', error);
      
      if (error instanceof NotFoundException || 
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to add product to favourites');
    }
  }
    // Get all favourite products for a user
  async findAllFavourite(user: userEntity) {
    try {
      const favourites = await this.prisma.favourite.findMany({
        where: {
          userId: user.id,
        },
        include: {
          product: {
         
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        message: 'Favourites retrieved successfully',
        data: favourites,
        count: favourites.length,
      };
    } catch (error) {
      console.error('Find favourites error:', error);
      throw new InternalServerErrorException('Failed to retrieve favourites');
    }
  }
  
  // Delete product: users can delete own, admins can delete any
  async remove(id: string, user: userEntity) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        select: {
          id: true,
          curatorId: true,
        },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      // Check permissions: user must be owner OR admin
      const userRecord = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });

      const isOwner = product.curatorId === user.id;
      const isAdmin = userRecord?.role === 'ADMIN';

      if (!isOwner && !isAdmin) {
        throw new ForbiddenException('You can only delete your own products');
      }

      // Actually delete the product (not just disable)
      await this.prisma.product.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Product deleted successfully',
      };
    } catch (error) {
      console.error('Delete product error:', error);
      
      if (error instanceof NotFoundException || 
          error instanceof ForbiddenException || 
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to delete product');
    }
  }
  // Get product availability
  async getProductAvailability(
    productId: string,
    startDate?: string,
    endDate?: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, dailyPrice: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate
      ? new Date(endDate)
      : new Date(new Date().setDate(new Date().getDate() + 60));

    // Get all rentals and cart items that overlap with the requested period
    const rentals = await this.prisma.rental.findMany({
      where: {
        productId,
        OR: [
          {
            startDate: { lte: end },
            endDate: { gte: start },
          },
        ],
        isReturned: false,
      },
    });

    // Calculate available dates
    const availableDates: string[] = [];
    const unavailableDates: string[] = [];
    const calendarData: any[] = [];
    const monthAvailability: any = {};

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const isBooked = rentals.some(
        (r) =>
          new Date(r.startDate) <= d &&
          new Date(r.endDate) >= d,
      );

      const dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'long' });
      const monthKey = dateStr.slice(0, 7); // YYYY-MM

      if (!monthAvailability[monthKey]) {
        monthAvailability[monthKey] = { total: 0, available: 0, unavailable: 0 };
      }
      monthAvailability[monthKey].total++;

      if (isBooked) {
        unavailableDates.push(dateStr);
        monthAvailability[monthKey].unavailable++;
      } else {
        availableDates.push(dateStr);
        monthAvailability[monthKey].available++;
      }

      calendarData.push({
        date: dateStr,
        available: !isBooked,
        dayOfWeek,
        bookedBy: isBooked ? 'reserved' : null,
      });
    }

    // Calculate stats
    Object.keys(monthAvailability).forEach((key) => {
      const m = monthAvailability[key];
      m.percentAvailable = Math.round((m.available / m.total) * 100);
    });

    return {
      success: true,
      data: {
        availability: {
          productId: product.id,
          productName: product.name,
          dailyPrice: product.dailyPrice,
          currency: 'NGN',
          availableDates,
          unavailableDates,
          monthAvailability,
          calendarData,
          minRentalDays: 1,
          maxConsecutiveDays: 30,
          checkDateFrom: start.toISOString(),
          checkDateTo: end.toISOString(),
        },
      },
    };
  }
}

oISOString(),
        },
      },
    };
  }
}

