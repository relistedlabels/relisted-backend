import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('Public - Search')
@Controller('api/public/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Global search' })
  @ApiQuery({ name: 'query', required: true, description: 'Search term' })
  @ApiQuery({ name: 'type', required: false, enum: ['product', 'brand', 'lister', 'all'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Search results retrieved successfully',
  })
  search(
    @Query('query') query: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.searchService.search(query, type ?? 'all', limitNum);
  }
}
