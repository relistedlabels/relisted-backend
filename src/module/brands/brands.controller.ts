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
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Brand } from '@prisma/client';

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
    schema: {
      example: {
        id: 'uuid',
        name: 'Nike',
        userId: 'uuid',
        fullText: 'Nike',
        createdAt: '2026-01-28T12:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  create(@Body() dto: CreateBrandDto, @AuthUser() user: userEntity) {
    return this.brandsService.create(dto, user);
  }

 
  @Get()
  @ApiOperation({ summary: 'Get all brands' })
  @ApiResponse({
    status: 200,
    description: 'List of all brands',
    schema: {
      example: [
        {
          id: 'uuid',
          name: 'Nike',
          userId: 'uuid',
          fullText: 'Nike',
          createdAt: '2026-01-28T12:00:00.000Z',
        },
        {
          id: 'uuid',
          name: 'Adidas',
          userId: 'uuid',
          fullText: 'Adidas',
          createdAt: '2026-01-28T12:05:00.000Z',
        },
      ],
    },
  })
  findAll() {
    return this.brandsService.findAll();
  }

  @Get('me')
  @ApiOperation({ summary: 'Get brands created by logged-in user' })
  @ApiResponse({
    status: 200,
    description: 'User brands fetched successfully',
    
    schema: {
      example: [
        {
          id: 'uuid',
          name: 'Nike',
          userId: 'uuid',
          fullText: 'Nike',
          createdAt: '2026-01-28T12:00:00.000Z',
        },
      ],
    },
  })
  findMyBrands(@AuthUser() user: userEntity) {
    return this.brandsService.findByUser(user.id);
  }

  
  @Get(':id')
  @ApiOperation({ summary: 'Get brand by ID' })
  @ApiParam({ name: 'id', description: 'Brand ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Brand fetched successfully',
    schema: {
      example: {
        id: 'uuid',
        name: 'Nike',
        userId: 'uuid',
        fullText: 'Nike',
        createdAt: '2026-01-28T12:00:00.000Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Brand not found' })
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(id);
  }

  
  @Patch(':id')
  @ApiOperation({ summary: 'Update a brand' })
  @ApiParam({ name: 'id', description: 'Brand ID', example: 'uuid' })
  @ApiBody({ type: UpdateBrandDto })
  @ApiResponse({
    status: 200,
    description: 'Brand updated successfully',
    schema: {
      example: {
        id: 'uuid',
        name: 'Updated Brand Name',
        userId: 'uuid',
        fullText: 'Updated Brand Name',
        createdAt: '2026-01-28T12:00:00.000Z',
        updatedAt: '2026-01-28T12:10:00.000Z',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'You do not own this brand',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
    @AuthUser() user: userEntity,
  ) {
    return this.brandsService.update(id, dto, user);
  }

  
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a brand' })
  @ApiParam({ name: 'id', description: 'Brand ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Brand deleted successfully',
    schema: {
      example: {
        message: 'Brand deleted successfully',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'You do not own this brand or you are not an admin',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Brand not found' })
  remove(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.brandsService.remove(id, user);
  }
}
