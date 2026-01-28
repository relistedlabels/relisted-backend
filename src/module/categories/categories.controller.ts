import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { userEntity } from '../auth/auth.types';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiParam,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

@ApiTags('Categories')
@ApiBearerAuth('token')
@Auth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new category' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiResponse({ status: 201, description: 'Category created successfully' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  create(@Body() dto: CreateCategoryDto, @AuthUser() user: userEntity) {
    return this.categoriesService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get all categories' })
  @ApiResponse({ status: 200, description: 'List of categories fetched' })
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Category fetched successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiResponse({ status: 200, description: 'Category updated successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Category deleted successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
