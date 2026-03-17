import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
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
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('Categories')
@ApiBearerAuth()
@Auth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}


  @Post()
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a new category' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Category created successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  create(
    @Body() dto: CreateCategoryDto,
    @AuthUser() user: userEntity,
    @UploadedFile() file?: any,
  ) {
    return this.categoriesService.create(dto, user, file);
  }

  
  @Get()
  @ApiOperation({ summary: 'Get all categories' })
  findAll() {
    return this.categoriesService.findAll();
  }


  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID' })
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

 
  @Patch(':id')
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update a category' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Category updated successfully',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @AuthUser() user: userEntity,
    @UploadedFile() file?: any,
  ) {
    return this.categoriesService.update(id, dto, user, file);
  }

 
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a category' })
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
