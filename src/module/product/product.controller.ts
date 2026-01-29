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
   * Create a new product (Curators only)
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
  @ApiForbiddenResponse({ description: 'Forbidden: Not a curator' })
  create(
    @Body() createProductDto: CreateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.create(createProductDto, user);
  }

  /**
   * List products (with optional pagination)
   */
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

  /**
   * Get all products created by the logged-in user
   */
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

  /**
   * Get product by ID
   */
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

  /**
   * Update product (Curators only)
   */
  @Auth([Role.LISTER])
  @Patch(':id')
  @ApiOperation({ summary: 'Update a product' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiBody({ type: UpdateProductDto })
  @ApiResponse({
    status: 200,
    description: 'Product updated successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not a curator' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.update(id, dto, user);
  }

  /**
   * Verify product (Admin only)
   */
  @Auth([Role.ADMIN])
  @Patch(':id/verify')
  @ApiOperation({ summary: 'Verify a product (Admin only)' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Product verified successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not an admin' })
  verifyProduct(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.productService.verifyProduct(id, user);
  }

  /**
   * Update product status (Curators only)
   */
  @Auth([Role.LISTER])
  @Patch(':id/status')
  @ApiOperation({ summary: 'Update product status (AVAILABLE, RENTED, etc.)' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiBody({ type: UpdateProductStatusDto })
  @ApiResponse({
    status: 200,
    description: 'Product status updated successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not a curator' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProductStatusDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.updateStatus(id, dto, user);
  }

  /**
   * Add product to favourites
   */
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

  /**
   * Delete product (Curators only)
   */
  @Auth([Role.LISTER])
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product' })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Product deleted successfully',
    schema: {
      example: { message: 'Product deleted successfully' },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not a curator' })
  remove(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.productService.remove(id, user);
  }
}
