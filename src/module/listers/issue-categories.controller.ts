import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Issue Categories')
@Controller('api')
export class IssueCategoriesController {
  @Get('issue-categories')
  @ApiOperation({ summary: 'List dispute issue categories' })
  @ApiResponse({ status: 200, description: 'Issue categories for disputes' })
  getIssueCategories() {
    return {
      success: true,
      data: {
        categories: [
          {
            categoryId: 'cat_001',
            name: 'Damaged Item',
            description: 'Item arrived with visible damage or defects',
            examples: ['Torn fabric', 'Broken zipper', 'Stain visible'],
          },
          {
            categoryId: 'cat_002',
            name: 'Incorrect Item Received',
            description:
              "Wrong item was sent or item doesn't match description",
            examples: ['Different color', 'Wrong size', 'Different brand'],
          },
          {
            categoryId: 'cat_003',
            name: 'Item Not Delivered',
            description: 'Item was never received or lost in transit',
            examples: [
              'Missing package',
              'Lost delivery',
              'No tracking updates',
            ],
          },
          {
            categoryId: 'cat_004',
            name: 'Hygiene Concern',
            description: 'Item has hygiene or cleanliness issues',
            examples: ['Foul smell', 'Visible dirt', 'Stain marks'],
          },
          {
            categoryId: 'cat_005',
            name: 'Misrepresented Description',
            description: "Item doesn't match the seller's description",
            examples: ['Different condition', 'Wrong material', 'Missing parts'],
          },
          {
            categoryId: 'cat_006',
            name: 'Other',
            description: 'Other issue not listed above',
            examples: [],
          },
        ],
        total: 6,
      },
    };
  }
}

