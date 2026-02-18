import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ProductService } from './product.service';
import {
  CreateFavouriteDto,
  CreateProductDto,
  ListProductQuery,
  queryDto,
  UpdateProductStatusDto,
  RejectProductDto,
  ToggleAvailabilityDto,
} from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';
import {
  ApiBody,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  /**
   * Create a new product (Listers only)
   */
  @Auth()
  @Post()
  @ApiOperation({ summary: 'Create a new product' })
  @ApiBody({ type: CreateProductDto })
  @ApiResponse({
    status: 201,
    description: 'Product created successfully',
    schema: {
      example: {
        id: 'uuid',
        name: 'Nike Shoes',
        dailyPrice: 1500,
        curatorId: 'uuid',
        status: 'AVAILABLE',
        createdAt: '2026-01-28T12:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not a lister' })
  create(
    @Body() createProductDto: CreateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.create(createProductDto, user);
  }

  
    // List products (with optional pagination)
   
  @Get()
  @ApiOperation({ summary: 'List all products with pagination' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Products retrieved successfully',
    schema: {
      example: [
        {
          id: 'uuid',
          name: 'Nike Shoes',
          dailyPrice: 1500,
          status: 'AVAILABLE',
          curatorId: 'uuid',
        },
      ],
    },
  })
  async list(@Query() query: ListProductQuery) {
    return this.productService.list(query);
  }

  
  //  Get all products created 
   
  @Auth()
  @Get('user-products')
  @ApiOperation({ summary: 'Get products created by the logged-in user' })
  @ApiResponse({
    status: 200,
    description: 'User products retrieved successfully',
    schema: {
      example: [
        {
          id: 'uuid',
          name: 'Nike Shoes',
          dailyPrice: 1500,
          status: 'AVAILABLE',
          curatorId: 'uuid',
        },
      ],
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getMyProducts(@AuthUser() user: userEntity) {
    return this.productService.getUserProducts(user);
  }

  // Get pending products for admin review (Admin only)
  @Auth([Role.ADMIN])
  @Get('pending')
  @ApiOperation({ summary: 'Get all pending products for review (Admin only)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'count', required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Pending products retrieved successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not an admin' })
  async getPendingProducts(@Query() query: ListProductQuery) {
    return this.productService.getPendingProducts(query);
  }

  // Get product statistics
  @Auth()
  @Get('statistics')
  @ApiOperation({
    summary: 'Get product statistics with products (total, approved, rejected, pending, active). Admins see all, listers see their own.',
  })
  @ApiResponse({
    status: 200,
    description: 'Product statistics retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          getTotalProducts: {
            count: 50,
            products: [],
          },
          getApprovedProducts: {
            count: 30,
            products: [],
          },
          getRejectedProducts: {
            count: 5,
            products: [],
          },
          getPendingProducts: {
            count: 10,
            products: [],
          },
          getActiveProducts: {
            count: 25,
            products: [],
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getStatistics(@AuthUser() user: userEntity) {
    return this.productService.getProductStatistics(user);
  }

  
  //  Add product to favourites
   
  @Auth()
  @Post('favourite')
  @ApiOperation({ summary: 'Add a product to favourites' })
  @ApiBody({ type: CreateFavouriteDto })
  @ApiResponse({
    status: 201,
    description: 'Product added to favourites',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  addFavourite(@Body() dto: CreateFavouriteDto, @AuthUser() user: userEntity) {
    return this.productService.createProductFavourite(dto, user);
  }

  //  * Get product by ID (must come after all specific routes)
  
  @Auth()
  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Product retrieved successfully',
    schema: {
      example: {
        id: 'uuid',
        name: 'Nike Shoes',
        dailyPrice: 1500,
        status: 'AVAILABLE',
        curatorId: 'uuid',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Product not found' })
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }




  
  // Approve product (Admin only)
  @Auth([Role.ADMIN])
  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a product (Admin only)' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Product approved successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not an admin' })
  approveProduct(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.productService.approveProduct(id, user);
  }

  // Reject product with comment (Admin only)
  @Auth([Role.ADMIN])
  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a product with comment (Admin only)' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiBody({ type: RejectProductDto })
  @ApiResponse({
    status: 200,
    description: 'Product rejected successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not an admin' })
  rejectProduct(
    @Param('id') id: string,
    @Body() dto: RejectProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.rejectProduct(id, dto.rejectionComment, user);
  }

  // Update product (Users can edit own, Admins can edit any)
  @Auth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a product (Users can edit own, Admins can edit any)' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiBody({ type: UpdateProductDto })
  @ApiResponse({
    status: 200,
    description: 'Product updated successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not the product owner' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.update(id, dto, user);
  }

  // Toggle product availability (only for approved products)
  // Users can deactivate their approved products manually
  @Auth()
  @Patch(':id/availability')
  @ApiOperation({
    summary:
      'Toggle product availability (only for approved products). Users can deactivate their own products.',
  })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiBody({ type: ToggleAvailabilityDto })
  @ApiResponse({
    status: 200,
    description: 'Product availability toggled successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not the product owner' })
  toggleAvailability(
    @Param('id') id: string,
    @Body() dto: ToggleAvailabilityDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.toggleAvailability(id, dto.isAvailable, user);
  }

  // Delete product (Users can delete own, Admins can delete any)
  @Auth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product (Users can delete own, Admins can delete any)' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Product deleted successfully',
    schema: {
      example: { success: true, message: 'Product deleted successfully' },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not the product owner or admin' })
  remove(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.productService.remove(id, user);
  }
}
