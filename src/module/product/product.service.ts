import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { connectId } from 'prisma/prisma.utils'; // REMOVE createAttachments from import
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import {
  PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
  productDetailIncludeOrdered,
  setProductAttachmentUploadDisplayOrder,
} from 'src/utils/product-attachment-upload-order';
import { userEntity } from '../auth/auth.types';
import {
  CreateFavouriteDto,
  CreateProductDto,
  GetUserProductsQueryDto,
  ListProductQuery,
  queryDto,
  UpdateProductStatusDto,
} from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductStatus } from '@prisma/client';
import { ClosetService } from '../closet/closet.service';
import { deleteProductCascade } from 'src/utils/cascade-delete';
import { MailService } from 'src/services/mail/mail.service';
import { fetchAdminAlertRecipients } from '../shipment/shipment-admin-alert-recipients';
import { assertProductAttachmentUploads } from 'src/utils/validate-product-attachment-uploads';
import { getShopSalePhase } from '../shop-sale/shop-sale.util';
import { applyProductListFilters } from './product-list-filters.util';
import {
  buildAdminPickerScopeWhere,
  buildProductListScopeWhere,
  collectProductFilterOptions,
} from './product-list-scope.util';

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ClosetService))
    private readonly closetService: ClosetService,
    private readonly mailService: MailService,
  ) {}

  async create(dto: CreateProductDto, user: userEntity) {
    try {
      // Validation for resale listings
      const listingType = dto.listingType || 'RENTAL';

      if (listingType === 'RENTAL') {
        if (!dto.dailyPrice) {
          throw new BadRequestException(
            'Daily price is required for RENTAL listings',
          );
        }
        if (dto.dailyPrice <= 0) {
          throw new BadRequestException('Daily price must be greater than 0');
        }
        if (!dto.originalValue || dto.originalValue <= 0) {
          throw new BadRequestException(
            'Original value must be greater than 0',
          );
        }
        if (!dto.quantity || dto.quantity <= 0) {
          throw new BadRequestException('Quantity must be greater than 0');
        }
      }

      if (listingType === 'RESALE') {
        if (!dto.resalePrice) {
          throw new BadRequestException(
            'Resale price is required for RESALE listings',
          );
        }
        if (dto.resalePrice <= 0) {
          throw new BadRequestException('Resale price must be greater than 0');
        }
        if (!dto.originalValue || dto.originalValue <= 0) {
          throw new BadRequestException(
            'Original value must be greater than 0',
          );
        }
        if (!dto.quantity || dto.quantity <= 0) {
          throw new BadRequestException('Quantity must be greater than 0');
        }
      }

      if (listingType === 'RENT_OR_RESALE') {
        if (!dto.dailyPrice) {
          throw new BadRequestException(
            'Daily price is required for RENT_OR_RESALE listings',
          );
        }
        if (dto.dailyPrice <= 0) {
          throw new BadRequestException('Daily price must be greater than 0');
        }
        if (!dto.resalePrice) {
          throw new BadRequestException(
            'Resale price is required for RENT_OR_RESALE listings',
          );
        }
        if (dto.resalePrice <= 0) {
          throw new BadRequestException('Resale price must be greater than 0');
        }
        if (!dto.originalValue || dto.originalValue <= 0) {
          throw new BadRequestException(
            'Original value must be greater than 0',
          );
        }
        if (!dto.quantity || dto.quantity <= 0) {
          throw new BadRequestException('Quantity must be greater than 0');
        }
      }

      const categoryId = dto.categoryId?.trim() || undefined;
      const brandId = dto.brandId?.trim() || undefined;
      let tagIdsToConnect: string[] = [];
      if (dto.tagids) {
        const incomingTags = Array.isArray(dto.tagids)
          ? dto.tagids
          : [dto.tagids];
        tagIdsToConnect = incomingTags
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id) => id.length > 0);

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

      if (dto.closetId) {
        await this.closetService.assertClosetAssignable(dto.closetId, user.id);
      }

      if (dto.attachments?.length) {
        await assertProductAttachmentUploads(
          this.prisma,
          dto.attachments,
          user.id,
        );
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
          dailyPrice:
            listingType === 'RESALE' ? 0 : dto.dailyPrice || 0,
          careInstruction: dto.careInstruction,
          careSteps: dto.careSteps ?? '',
          stylingTip: dto.stylingTip,
          quantity: dto.quantity || 1,
          composition: dto.composition || '',
          warning: dto.warning || '',
          curatorId: user.id,
          status: ProductStatus.PENDING, // Products start in pending state
          productVerified: false,
          listingType: listingType,
          resalePrice: dto.resalePrice,
          ...(brandId && { brandId }),
          ...(categoryId && { categoryId }),
          ...(tagIdsToConnect.length > 0 && {
            tags: {
              connect: tagIdsToConnect.map((id) => ({ id })),
            },
          }),

          // Only create attachments if there are valid uploads
          ...(dto.attachments?.length && {
            attachments: {
              create: {
                uploads: {
                  connect: dto.attachments.map((id) => ({ id })),
                },
              },
            },
          }),
          ...(dto.closetId && { closetId: dto.closetId }),
        },
        include: productDetailIncludeOrdered,
      });

      if (dto.attachments?.length) {
        await setProductAttachmentUploadDisplayOrder(
          this.prisma,
          dto.attachments,
        );
      }

      const product = dto.attachments?.length
        ? await this.prisma.product.findUnique({
            where: { id: newProduct.id },
            include: productDetailIncludeOrdered,
          })
        : newProduct;

      try {
        const admins = await fetchAdminAlertRecipients(this.prisma);
        const origin = (
          process.env.CLIENT_URL ||
          process.env.FRONTEND_URL ||
          'http://localhost:3000'
        ).replace(/\/$/, '');
        const adminSegment =
          process.env.ADMIN_SECRET_SEGMENT?.trim() || 'k340eol21';
        const adminLink = `${origin}/admin/${adminSegment}/listings`;
        const created = product ?? newProduct;
        await Promise.all(
          admins
            .filter((admin) => admin.email?.trim())
            .map((admin) =>
              this.mailService.sendAdminNewListingAlert({
                to: admin.email.trim(),
                adminName: admin.name,
                productName: created.name,
                listingType,
                listerName: user.name,
                listerEmail: user.email,
                adminLink,
              }),
            ),
        );
      } catch (err) {
        console.warn('[Product] Admin new listing email failed:', err);
      }

      return {
        success: true,
        message: 'Product created successfully',
        product: product ?? newProduct,
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
      const limit = Number(query.count) || 20;
      const skip = (page - 1) * limit;

      // 1. Build where clause
      const where: any = await buildProductListScopeWhere(this.prisma, {
        sale: query.sale,
        closetId: query.closetId,
        onlyWithCloset: query.onlyWithCloset,
        excludeStagingCurator: query.excludeStagingCurator,
      });
      const inClosetListContext = Boolean(
        query.closetId || query.onlyWithCloset,
      );

      applyProductListFilters(where, {
        category: query.category,
        brand: query.brand,
        tags: query.tags,
        listingType: query.listingType,
        curatorId: query.curatorId,
        color: query.color,
        size: query.size,
        condition: query.condition,
        material: query.material,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
      });

      if (query.search) {
        const searchOr: Record<string, unknown>[] = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { subText: { contains: query.search, mode: 'insensitive' } },
          {
            brand: { name: { contains: query.search, mode: 'insensitive' } },
          },
          {
            category: {
              name: { contains: query.search, mode: 'insensitive' },
            },
          },
          {
            tags: {
              some: { name: { contains: query.search, mode: 'insensitive' } },
            },
          },
          { color: { contains: query.search, mode: 'insensitive' } },
          { composition: { contains: query.search, mode: 'insensitive' } },
        ];

        if (inClosetListContext) {
          searchOr.push({
            closet: {
              is: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
          });
          searchOr.push({
            closet: {
              is: {
                slug: { contains: query.search, mode: 'insensitive' },
              },
            },
          });
          searchOr.push({
            closet: {
              is: {
                description: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
          });
        }

        const searchFilter = { OR: searchOr };

        if (!where.AND) where.AND = [];
        where.AND.push(searchFilter);
      }

      if (query.excludeStagingCurator === true) {
        const stagingCuratorId =
          process.env.STAGING_INTERNAL_CURATOR_ID ??
          '7d172d18-daad-46cd-ab6d-8d8af28c0b16';
        const omitStaging = { NOT: { curatorId: stagingCuratorId } };
        if (!where.AND) {
          where.AND = [];
        }
        where.AND.push(omitStaging);
      }

      // 2. Build orderBy
      let orderBy: any = { createdAt: 'desc' }; // Default: newest
      if (query.sort) {
        switch (query.sort) {
          case 'oldest':
            orderBy = { createdAt: 'asc' };
            break;
          case 'price_low':
            // For RESALE products, sort by resalePrice; for RENTAL, sort by dailyPrice
            orderBy = [
              { dailyPrice: 'asc' as const },
              { resalePrice: 'asc' as const },
            ];
            break;
          case 'price_high':
            // For RESALE products, sort by resalePrice; for RENTAL, sort by dailyPrice
            orderBy = [
              { dailyPrice: 'desc' as const },
              { resalePrice: 'desc' as const },
            ];
            break;
          case 'popular':
            // If we have a viewCount or similar, we can sort by it.
            // For now fallback to newest if not available.
            orderBy = { favourites: { _count: 'desc' } };
            break;
          case 'rating':
            orderBy = { reviews: { _avg: { rating: 'desc' } } };
            break;
        }
      }

      const applyShopBrandPriority = !inClosetListContext;
      const finalOrderBy = applyShopBrandPriority
        ? Array.isArray(orderBy)
          ? [{ brand: { isShopPrioritized: 'desc' as const } }, ...orderBy]
          : [{ brand: { isShopPrioritized: 'desc' as const } }, orderBy]
        : orderBy;

      // Fetch products and total count in parallel
      const [products, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy: finalOrderBy,
          include: {
            brand: {
              select: { id: true, name: true },
            },
            category: {
              select: { id: true, name: true },
            },
            tags: {
              select: { id: true, name: true },
            },
            attachments: {
              include: {
                uploads: {
                  orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                  select: { id: true, url: true },
                },
              },
            },
            closet: {
              select: { id: true, name: true, slug: true, imageUrl: true },
            },
            _count: {
              select: { favourites: true, reviews: true },
            },
          },
        }),
        this.prisma.product.count({
          where,
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

  async getShopFilterOptions(
    query: Pick<
      ListProductQuery,
      'sale' | 'closetId' | 'onlyWithCloset' | 'excludeStagingCurator'
    >,
  ) {
    const where = await buildProductListScopeWhere(this.prisma, query);

    if (query.excludeStagingCurator === true) {
      const stagingCuratorId =
        process.env.STAGING_INTERNAL_CURATOR_ID ??
        '7d172d18-daad-46cd-ab6d-8d8af28c0b16';
      const omitStaging = { NOT: { curatorId: stagingCuratorId } };
      if (!where.AND) where.AND = [omitStaging];
      else if (Array.isArray(where.AND)) where.AND.push(omitStaging);
      else where.AND = [where.AND, omitStaging];
    }

    const data = await collectProductFilterOptions(this.prisma, where);
    return { success: true, data };
  }

  async getAdminPickerFilterOptions() {
    const data = await collectProductFilterOptions(
      this.prisma,
      buildAdminPickerScopeWhere(),
    );
    return { success: true, data };
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
              {
                productVerified: false,
                status: { not: ProductStatus.APPROVED },
              },
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
                  orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
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
              {
                productVerified: false,
                status: { not: ProductStatus.APPROVED },
              },
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
      throw new InternalServerErrorException(
        'Failed to retrieve pending products',
      );
    }
  }

  // Get user all products with their statuses (for dashboard)
  async getUserProducts(
    user: userEntity,
    filters?: GetUserProductsQueryDto,
  ) {
    try {
      if (filters?.closetId && filters?.uncategorized) {
        throw new BadRequestException(
          'Use either closetId or uncategorized, not both',
        );
      }

      const where: {
        curatorId: string;
        closetId?: string | null;
      } = {
        curatorId: user.id,
      };
      if (filters?.uncategorized) {
        where.closetId = null;
      } else if (filters?.closetId) {
        where.closetId = filters.closetId;
      }

      const products = await this.prisma.product.findMany({
        where,
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
          listingType: true,
          resalePrice: true,
          rentalCount: true,
          closetId: true,
          attachments: {
            include: {
              uploads: {
                orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
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
          closet: {
            select: { id: true, name: true, slug: true, imageUrl: true },
          },
        },
      });

      // Add depreciationPrompt to each product
      const productsWithPrompt = products.map((product) => ({
        ...product,
        depreciationPrompt:
          product.rentalCount >= 5 &&
          (product.listingType === 'RENTAL' ||
            product.listingType === 'RENT_OR_RESALE') &&
          product.resalePrice === null,
      }));

      return {
        success: true,
        message: 'User products retrieved successfully',
        data: productsWithPrompt,
        count: products.length,
      };
    } catch (error) {
      console.error('Get user products error:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to retrieve user products',
      );
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
        listingType: true,
        resalePrice: true,
        rentalCount: true,
        createdAt: true,
        updatedAt: true,
        attachments: {
          include: {
            uploads: {
              orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
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
      throw new InternalServerErrorException(
        'Failed to retrieve product statistics',
      );
    }
  }

  //  Get product by ID with detailed information

  private async getActiveSaleContextForProduct(productId: string) {
    const row = await this.prisma.shopSaleProduct.findFirst({
      where: {
        productId,
        sale: { isEnabled: true },
      },
      include: { sale: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    const phase = getShopSalePhase(row.sale);
    if (phase === 'ended' || phase === 'off') return null;
    return {
      slug: row.sale.slug,
      headline: row.sale.headline,
      preSaleMessage: row.sale.preSaleMessage,
      shopAccessEnabled: row.sale.shopAccessEnabled,
      phase,
      earliestDeliveryAt: row.sale.earliestDeliveryAt?.toISOString() ?? null,
    };
  }

  async findOne(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          attachments: {
            include: {
              uploads: {
                orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                select: {
                  id: true,
                  url: true,
                  type: true,
                  displayOrder: true,
                },
              },
            },
          },
          brand: true,
          category: true,
          tags: true,
          closet: {
            select: { id: true, name: true, slug: true, imageUrl: true },
          },
        },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      if (!product.isActive) {
        // Resale completion sets SOLD + isActive false; still allow PDP for sold-out display
        if (product.status !== ProductStatus.SOLD) {
          throw new BadRequestException('This product is currently unavailable');
        }
      }

      const activeSale = await this.getActiveSaleContextForProduct(product.id);

      return {
        success: true,
        message: 'Product retrieved successfully',
        data: { ...product, activeSale },
      };
    } catch (error) {
      console.error('Find one product error:', error);

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
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
        throw new BadRequestException(
          'Cannot approve a rejected product. Please contact support.',
        );
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

      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
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
        throw new BadRequestException(
          'Cannot reject an approved product. Use delete instead.',
        );
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

      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
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
        throw new ForbiddenException(
          'You can only toggle availability of your own products',
        );
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
          status: isAvailable
            ? ProductStatus.AVAILABLE
            : ProductStatus.UNAVAILABLE,
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

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to toggle product availability',
      );
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

      if (Array.isArray(dto.attachments) && dto.attachments.length > 0) {
        await assertProductAttachmentUploads(
          this.prisma,
          dto.attachments,
          user.id,
          id,
        );
      }

      // Users can only edit pending or rejected products (to resubmit)
      // Admins can edit any product
      // if (!isAdmin && product.status !== ProductStatus.PENDING && product.status !== ProductStatus.REJECTED) {
      //   throw new BadRequestException(
      //     'You can only edit products that are pending or rejected. Current status: ' + product.status
      //   );
      // }

      // Non-admin edits require re-approval, except during active rental or after sale.
      const updateData: any = { ...dto };
      const preserveStatus =
        product.status === ProductStatus.RENTED ||
        product.status === ProductStatus.SOLD;
      if (!isAdmin && !preserveStatus) {
        updateData.status = ProductStatus.PENDING;
        updateData.rejectionComment = null;
      }

      // Map brand/category FK scalars to relation writes (Prisma ProductUpdateInput does not
      // accept `brandId` / `categoryId` alongside nested `attachments` updates in v7).
      if (dto.brandId !== undefined) {
        delete updateData.brandId;
        if (dto.brandId === null || dto.brandId === '') {
          updateData.brand = { disconnect: true };
        } else {
          updateData.brand = {
            connect: { id: String(dto.brandId).trim() },
          };
        }
      } else {
        delete updateData.brandId;
      }

      if (dto.categoryId !== undefined) {
        delete updateData.categoryId;
        if (dto.categoryId === null || dto.categoryId === '') {
          updateData.category = { disconnect: true };
        } else {
          updateData.category = {
            connect: { id: String(dto.categoryId).trim() },
          };
        }
      } else {
        delete updateData.categoryId;
      }

      // Never pass raw `attachments: string[]` to Prisma. Empty `[]` must not run
      // `uploads: { set: [] }` (it disconnects every image while leaving Attachments).
      delete updateData.attachments;
      if (Array.isArray(dto.attachments) && dto.attachments.length > 0) {
        updateData.attachments = {
          upsert: {
            create: {
              uploads: {
                connect: dto.attachments.map((id: string) => ({ id })),
              },
            },
            update: {
              uploads: { set: dto.attachments.map((id: string) => ({ id })) },
            },
          },
        };
      }

      if (dto.tagids) {
        const incomingTags = Array.isArray(dto.tagids)
          ? dto.tagids
          : [dto.tagids];
        const tagsToSet = incomingTags
          .map((id: string) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id: string) => id.length > 0);
        updateData.tags = {
          set: tagsToSet.map((id: string) => ({ id })),
        };
        delete updateData.tagids;
      }

      delete updateData.removeImages;
      delete updateData.addImages;
      delete updateData.keepImages;
      delete updateData.closetId;

      if (dto.closetId !== undefined) {
        if (dto.closetId === null || dto.closetId === '') {
          updateData.closet = { disconnect: true };
        } else {
          await this.closetService.assertClosetAssignable(
            dto.closetId,
            product.curatorId,
          );
          updateData.closet = { connect: { id: dto.closetId } };
        }
      }

      if (updateData.listingType === 'RESALE') {
        updateData.dailyPrice = 0;
      }

      const updatedProduct = await this.prisma.product.update({
        where: { id },
        data: updateData,
        include: productDetailIncludeOrdered,
      });

      if (dto.attachments?.length) {
        await setProductAttachmentUploadDisplayOrder(
          this.prisma,
          dto.attachments,
        );
      }

      const data =
        dto.attachments?.length
          ? await this.prisma.product.findUnique({
              where: { id },
              include: productDetailIncludeOrdered,
            })
          : updatedProduct;

      return {
        success: true,
        message: 'Product updated successfully',
        data: data ?? updatedProduct,
      };
    } catch (error) {
      console.error('Update product error:', error);

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
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
        throw new NotFoundException(
          `Product with ID ${dto.productId} not found`,
        );
      }

      if (!product.isActive) {
        throw new BadRequestException(
          'Cannot add inactive product to favourites',
        );
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
          product: {},
        },
      });

      return {
        success: true,
        message: 'Product added to favourites successfully',
        data: favourite,
      };
    } catch (error) {
      console.error('Create favourite error:', error);

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to add product to favourites',
      );
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
          product: {},
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

      await this.prisma.$transaction(async (tx) => {
        await deleteProductCascade(tx, id);
      });

      return {
        success: true,
        message: 'Product deleted successfully',
      };
    } catch (error) {
      console.error('Delete product error:', error);

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
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
        (r) => new Date(r.startDate) <= d && new Date(r.endDate) >= d,
      );

      const dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'long' });
      const monthKey = dateStr.slice(0, 7); // YYYY-MM

      if (!monthAvailability[monthKey]) {
        monthAvailability[monthKey] = {
          total: 0,
          available: 0,
          unavailable: 0,
        };
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

  async getResaleHistory(productId: string, user: userEntity) {
    try {
      // First verify user owns the product
      const product = await this.prisma.product.findFirst({
        where: {
          id: productId,
          curatorId: user.id,
        },
      });

      if (!product) {
        throw new BadRequestException('Product not found or access denied');
      }

      // Get completed resale orders for this product
      const resaleOrders = (await this.prisma.order.findMany({
        where: {
          orderItems: {
            some: {
              productId: productId,
            },
          },
          listingType: { in: ['RESALE', 'RENT_OR_RESALE'] },
          status: 'COMPLETED',
        },
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  resalePrice: true,
                },
              },
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })) as Array<{
        orderItems: Array<{
          product: {
            id: string;
            name: string;
            resalePrice: number | null;
          };
          days: number;
        }>;
        user: {
          id: string;
          name: string | null;
          email: string | null;
        };
        orderId: string;
        updatedAt: Date;
        listingType: string;
      }>;

      return {
        success: true,
        message: 'Resale history retrieved successfully',
        data: resaleOrders
          .filter((order) => {
            // For RESALE orders, include all if items exist
            if (order.listingType === 'RESALE') {
              return order.orderItems && order.orderItems.length > 0;
            }
            // For RENT_OR_RESALE orders, only include if at least one item has days = 0 (resale)
            if (order.listingType === 'RENT_OR_RESALE') {
              return (
                order.orderItems &&
                order.orderItems.some((item) => item.days === 0)
              );
            }
            return false;
          })
          .map((order) => ({
            orderId: order.orderId,
            resalePrice: order.orderItems[0]?.product?.resalePrice,
            productName: order.orderItems[0]?.product?.name,
            buyerName: order.user?.name,
            buyerEmail: order.user?.email,
            completedAt: order.updatedAt, // Using updatedAt as completion timestamp
          })),
        depreciationPrompt:
          product.rentalCount >= 5 &&
          (product.listingType === 'RENTAL' ||
            product.listingType === 'RENT_OR_RESALE') &&
          product.resalePrice === null,
      };
    } catch (error) {
      console.error('Get resale history error:', error);
      throw new InternalServerErrorException(
        'Failed to retrieve resale history',
      );
    }
  }
}
