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
import { CreateFavouriteDto, CreateProductDto, ListProductQuery, UpdateProductStatusDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';

@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Auth([Role.CURATOR])
  @Post()
  create(
    @Body() createProductDto: CreateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.create(createProductDto, user);
  }



   @Get()
   async list(@Query() query: ListProductQuery) {
    return await this.productService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Auth([Role.CURATOR])
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @AuthUser() user: userEntity,
  ) {
    return this.productService.update(id, dto, user);
  }

  @Auth([Role.CURATOR])
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, dto:UpdateProductStatusDto ,@AuthUser() user: userEntity) {
    return this.productService.updateStatus(id,dto, user);
  }
  
  @Auth() 
  @Post()
  addFavourite(@Body() dto: CreateFavouriteDto, @AuthUser() user: userEntity) {
    return this.productService.createProductFavourite(dto, user);
  }

  @Auth([Role.CURATOR])
  @Delete(':id')
  remove(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.productService.remove(id, user);
  }
}
