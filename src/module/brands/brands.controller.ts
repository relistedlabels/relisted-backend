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
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

@ApiTags('Brands')
@ApiBearerAuth()
@Auth()
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new brand' })
  @ApiBody({ type: CreateBrandDto })
  @ApiResponse({
    status: 201,
    description: 'Brand created successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  create(
    @Body() dto: CreateBrandDto,
    @AuthUser() user: userEntity,
  ) {
    return this.brandsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get all brands' })
  @ApiResponse({
    status: 200,
    description: 'List of all brands',
  })
  findAll() {
    return this.brandsService.findAll();
  }

  @Get('me')
  @ApiOperation({ summary: 'Get brands created by logged-in user' })
  @ApiResponse({
    status: 200,
    description: 'User brands fetched successfully',
  })
  findMyBrands(@AuthUser() user: userEntity) {
    return this.brandsService.findByUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get brand by ID' })
  @ApiParam({ name: 'id', description: 'Brand ID' })
  @ApiResponse({
    status: 200,
    description: 'Brand fetched successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Brand not found',
  })
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a brand' })
  @ApiParam({ name: 'id', description: 'Brand ID' })
  @ApiBody({ type: UpdateBrandDto })
  @ApiResponse({
    status: 200,
    description: 'Brand updated successfully',
  })
  @ApiForbiddenResponse({
    description: 'You do not own this brand',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
    @AuthUser() user: userEntity,
  ) {
    return this.brandsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a brand' })
  @ApiParam({ name: 'id', description: 'Brand ID' })
  @ApiResponse({
    status: 200,
    description: 'Brand deleted successfully',
  })
  @ApiForbiddenResponse({
    description: 'You do not own this brand',
  })
  remove(
    @Param('id') id: string,
    @AuthUser() user: userEntity,
  ) {
    return this.brandsService.remove(id, user.id);
  }
}
