import { Controller, Get, UseGuards } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Admin - Newsletter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/newsletter')
export class NewsletterAdminController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Get('subscribers')
  @ApiOperation({ summary: 'Get all newsletter subscribers' })
  @ApiResponse({ status: 200, description: 'Subscribers retrieved successfully' })
  async getAllSubscribers() {
    const subscribers = await this.newsletterService.getAllSubscribers();
    return {
      success: true,
      data: subscribers,
    };
  }
}
