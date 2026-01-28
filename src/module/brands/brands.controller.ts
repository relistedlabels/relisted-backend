import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { userEntity } from '../auth/auth.types';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Brands')
@ApiBearerAuth()
@Auth()
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  
  @Post()
  create(
    @Body() dto: CreateBrandDto,
    @AuthUser() user: userEntity,
  ) {
    return this.brandsService.create(dto, user);
  }


  @Get()
  findAll() {
    return this.brandsService.findAll();
  }


  @Get('me')
  findMyBrands(@AuthUser() user: userEntity) {
    return this.brandsService.findByUser(user.id);
  }

  
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(id);
  }

 
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
    @AuthUser() user: userEntity,
  ) {
    return this.brandsService.update(id, dto, user.id);
  }

  
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @AuthUser() user: userEntity,
  ) {
    return this.brandsService.remove(id, user.id);
  }
}
