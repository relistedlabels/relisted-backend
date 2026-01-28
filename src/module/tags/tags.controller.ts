import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { Auth } from '../auth/decorator/auth.decorator';

@ApiTags('Tags')
@ApiBearerAuth('token')
@Auth()
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new tag' })
  @ApiCreatedResponse({
    description: 'Tag created successfully',
    schema: {
      example: {
        id: 'uuid',
        name: 'Trending',
        createdAt: '2026-01-28T12:00:00.000Z',
      },
    },
  })
  @ApiConflictResponse({ description: 'Tag already exists' })
  create(@Body() dto: CreateTagDto) {
    return this.tagsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tags' })
  @ApiOkResponse({
    description: 'Tags fetched successfully',
    schema: {
      example: [
        { id: 'uuid', name: 'Trending' },
        { id: 'uuid', name: 'Luxury' },
      ],
    },
  })
  findAll() {
    return this.tagsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tag by ID' })
  @ApiOkResponse({
    description: 'Tag fetched successfully',
    schema: {
      example: { id: 'uuid', name: 'Trending' },
    },
  })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  findOne(@Param('id') id: string) {
    return this.tagsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tag' })
  @ApiOkResponse({
    description: 'Tag updated successfully',
    schema: {
      example: { id: 'uuid', name: 'Best Seller' },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid input' })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tagsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a tag' })
  @ApiOkResponse({
    description: 'Tag deleted successfully',
    schema: {
      example: { message: 'Tag deleted successfully' },
    },
  })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  remove(@Param('id') id: string) {
    return this.tagsService.remove(id);
  }
}
