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
    //  Validate that all upload IDs exist
    if (dto.attachments?.length) {
      const existingUploads = await this.prisma.upload.findMany({
        where: {
          id: { in: dto.attachments }
        },
        select: { id: true }
      });
      
      // Check if all IDs exist
      const existingIds = existingUploads.map(upload => upload.id);
      const missingIds = dto.attachments.filter(id => !existingIds.includes(id));
      
      if (missingIds.length > 0) {
        throw new BadRequestException(
          `The following upload IDs do not exist: ${missingIds.join(', ')}. ` +
          `Please upload files first or use valid upload IDs.`
        );
      }
    }

    // Create the product with validated attachments
    const newProduct = await this.prisma.product.create({
      data: {
        name: dto.name,
        subText: dto.subText,
        description: dto.description,
        condition: dto.condition,
        measurement: dto.measurement,
        color: dto.color,
        originalValue: dto.originalValue || 0,
        dailyPrice: dto.dailyPrice,
        careInstruction: dto.careInstruction,
        careSteps: dto.careSteps,
        stylingTip: dto.stylingTip,
        quantity: dto.quantity || 1,
        composition: dto.composition || '',
        warning: dto.warning || '',
        curatorId: user.id,
        ...(dto.brandId && { brandId: dto.brandId }),
        ...(dto.categoryId && { categoryId: dto.categoryId }),
        ...(dto.tagId && { tagId: dto.tagId }),
        
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
 
// only show all verified product ,active product
  async list(query: ListProductQuery) {
    try {
      const page = Number(query.page) || 1;
      const limit = Number(query.count) || 10;
      const skip = (page - 1) * limit;

      // Fetch products and total count in parallel
      const [products, total] = await Promise.all([
        this.prisma.product.findMany({
          where: {
            isActive: true,
            productVerified: true,
            status: ProductStatus.AVAILABLE,
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.product.count({
          where: {
            isActive: true,
            productVerified: true,
            status: ProductStatus.AVAILABLE,
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


  //get user all products 
  async getUserProducts(user: userEntity) {
    try {
      const products = await this.prisma.product.findMany({
        where: {
          curatorId: user.id,
        },
        orderBy: { createdAt: 'desc' },
        include:{
          attachments:true,
         curator:{
          select:{
            name:true,
            id:true

          }
         }
        }
        
      });

      console.log("product",products)

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

    
  //  Get product by ID with detailed information
   
  async findOne(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
     
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
  

 async update(productId: string, dto: UpdateProductDto, user: userEntity) {
  const product = await this.prisma.$transaction(async (tx) => {

    const product = await tx.product.findUnique({
      where: { id:productId},
      include: {
        attachments:{ 
          include: {
            uploads: true 
          }
        }
      }
    });

    if (!product) bad('Product not found', 404);
    if (product.curatorId !== user.id) bad('Unauthorized', 403);
    if (!product.isActive) bad('Product is disabled', 400);

    const currentImageIds = product.attachments?.uploads?.map(u => u.id) || [];
    

    // check for removal images validation
    if (dto.removeImages) {
      const invalidRemovals = dto.removeImages.filter(
        id => !currentImageIds.includes(id)
      );
      if (invalidRemovals.length > 0) {
        bad(`Cannot remove images that don't exist: ${invalidRemovals.join(', ')}`, 400);
      }
    }



    if (dto.keepImages) {
      const invalidKeeps = dto.keepImages.filter(
        id => !currentImageIds.includes(id)
      );
      if (invalidKeeps.length > 0) {
        bad(`Cannot keep images that don't exist: ${invalidKeeps.join(', ')}`, 400);
      }
    }

    let finalImageIds = [...currentImageIds];
    
    if (dto.removeImages?.length) {
      finalImageIds = finalImageIds.filter(id => !dto.removeImages?.includes(id));
    }
    

    if (dto.keepImages?.length) {
      finalImageIds = dto.keepImages;
    }
    
    
    if (dto.addImages?.length) {
      finalImageIds = [...finalImageIds, ...dto.addImages];
    }


    const existingUploads = await tx.upload.findMany({
      where: { id: { in: finalImageIds } },
      select: { id: true }
    });

    const existingUploadIds = existingUploads.map(u => u.id);
    const missingUploads = finalImageIds.filter(id => !existingUploadIds.includes(id));
    
    if (missingUploads.length > 0) {
      bad(`The following images were not found: ${missingUploads.join(', ')}. Please upload them first.`, 400);
    }

    // Delete all current attachments
    if (product.attachments) {
      await tx.attachments.deleteMany({
        where: { productId: productId }
      });
      
    }



    // Create new attachment with final image set
    if (finalImageIds.length > 0) {
      await tx.attachments.create({
        data: {
          productId: productId,
          uploads: {
            connect: finalImageIds.map(id => ({ id }))
          }
        }
      });

    }

    const updatedProduct = await tx.product.update({
      where: { id:productId },
       data: {
        name: dto.name,
        subText: dto.subText,
        description: dto.description,
        condition: dto.condition,
        measurement: dto.measurement,
        color: dto.color,
        originalValue: dto.originalValue || 0,
        dailyPrice: dto.dailyPrice,
        careInstruction: dto.careInstruction,
        careSteps: dto.careSteps,
        stylingTip: dto.stylingTip,
        quantity: dto.quantity || 1,
        composition: dto.composition || '',
        warning: dto.warning || '',
        curatorId: user.id,
        ...(dto.brandId && { brandId: dto.brandId }),
        ...(dto.categoryId && { categoryId: dto.categoryId }),
        ...(dto.tagId && { tagId: dto.tagId }),
      },
      include: {
        attachments: {
          include: { uploads: true }
        }
      }
    });

    return {
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct,
      
    };
  });
}



  async verifyProduct(id: string, user: userEntity) {
    try {
     
      const product = await this.prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      if (product.productVerified) {
        throw new BadRequestException('Product is already verified');
      }

      const verifiedProduct = await this.prisma.product.update({
        where: { id },
        data: {
          productVerified: true,
          // verifiedAt: new Date(),
          // verifiedBy: user.id,
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
        message: 'Product verified successfully',
        data: verifiedProduct,
      };
    } catch (error) {
      console.error('Verify product error:', error);
      
      if (error instanceof ForbiddenException || 
          error instanceof NotFoundException || 
          error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to verify product');
    }
  }


  //  Update product status (active/inactive)
  
  async updateStatus(id: string, dto: UpdateProductStatusDto, user: userEntity) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

    

      const updatedProduct = await this.prisma.product.update({
        where: { id },
        data: {
          isActive: dto.isActive,
          ...(dto.isActive === false && { status: ProductStatus.MAINTENANCE }),
          ...(dto.isActive === true && { status: ProductStatus.AVAILABLE }),
        },
      });

      return {
        success: true,
        message: dto.isActive 
          ? 'Product enabled successfully' 
          : 'Product disabled successfully',
        data: updatedProduct,
      };
    } catch (error) {
      console.error('Update product status error:', error);
      
      if (error instanceof NotFoundException || 
          error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to update product status');
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
  
  // lister disable thier product
  async remove(id: string, user: userEntity) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      

    

      
      await this.prisma.product.update({
        where: { id },
        data: {
          isActive: false,
          status: ProductStatus.MAINTENANCE,
        },
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
      
      throw new InternalServerErrorException('Failed to set  product to disable');
    }
  }
}

