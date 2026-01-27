import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ProductService } from './product.service';
import {
  CreateFavouriteDto,
  CreateProductDto,
  ListProductQuery,
  UpdateProductStatusDto,
} from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiCookieAuth('access_token')
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Auth([Role.LISTER])
  @Post()
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: Not a curator' })
  @ApiBody({ type: CreateProductDto })
  create(
    @Body() createProductDto: CreateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.create(createProductDto, user);
  }

  @Get()
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(@Query() query: ListProductQuery) {
    return await this.productService.list(query);
  }

  @Auth()
  @Get('user-products')
  @ApiResponse({ status: 200, description: 'userproducts retrieved successfully' })
  async getMyProducts(
    @AuthUser() user: userEntity,
   
  ) {
    return await this.productService.getUserProducts(user);
  }

  @Auth()
  @Get(':id')
  @ApiResponse({ status: 200, description: 'Product retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Auth([Role.LISTER])
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.update(id, dto, user);
  }



  
  // ADMIN VERIFICATION ENDPOINT
  @Auth([Role.ADMIN])
  @Patch(':id/verify')
  @ApiResponse({
    status: 200,
    description: 'Product verified successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: Not an admin' })
  verifyProduct(
    @Param('id') id: string,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.verifyProduct(id, user);
  }


  @Auth([Role.LISTER])
  @Patch(':id/status')
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: Not a curator' })
  @ApiBody({ type: UpdateProductDto })
  updateStatus(
    @Param('id') id: string,
    dto: UpdateProductStatusDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.updateStatus(id, dto, user);
  }

  //  UPDATE PRODUCT STATUS
  @Auth([Role.LISTER])
  @Patch(':id/status')
  @ApiResponse({
    status: 200,
    description: 'Product status updated successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: UpdateProductStatusDto })
  updateProductStatus(
    @Param('id') id: string,
  
    @AuthUser() user: userEntity,
  ) {
    return this.productService.updateProductStatus(id, user);
  }

  @Auth()
  @Post("/favourite")
  @ApiResponse({ status: 201, description: 'Product added to favourites' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: CreateFavouriteDto })
  addFavourite(@Body() dto: CreateFavouriteDto, @AuthUser() user: userEntity) {
    return this.productService.createProductFavourite(dto, user);
  }

  @Auth([Role.LISTER])
  @Delete(':id')
  @ApiResponse({ status: 200, description: 'Product deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: Not a curator' })
  remove(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.productService.remove(id, user);
  }



}
