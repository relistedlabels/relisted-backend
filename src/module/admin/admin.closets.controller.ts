import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('Admin Closets')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/closets')
export class AdminClosetsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'List all closets (paginated, searchable)' })
  async listClosets(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listClosetsForAdmin(
      page ? parseInt(page, 10) || 1 : 1,
      limit ? parseInt(limit, 10) || 20 : 20,
      search,
    );
  }

  @Get(':closetId')
  @ApiOperation({ summary: 'Get one closet with products and wallet balance' })
  async getCloset(@Param('closetId') closetId: string) {
    return this.adminService.getClosetDetailForAdmin(closetId);
  }
}
