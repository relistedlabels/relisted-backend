import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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

  @Get('vault-closet-sale/waitlist')
  @ApiOperation({
    summary: 'List Vault Closet sale email waitlist (VaultClosetSaleInterest)',
  })
  async listVaultClosetSaleWaitlist(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listVaultClosetSaleWaitlistForAdmin(
      page ? parseInt(page, 10) || 1 : 1,
      limit ? parseInt(limit, 10) || 20 : 20,
    );
  }

  @Post('vault-closet-sale/notify-waitlist')
  @ApiOperation({
    summary:
      'Send the "sale is live" email to every address on the Vault Closet sale waitlist',
  })
  async notifyVaultClosetSaleWaitlist() {
    return this.adminService.notifyVaultClosetSaleWaitlistForAdmin();
  }

  @Get(':closetId')
  @ApiOperation({ summary: 'Get one closet with products and wallet balance' })
  async getCloset(@Param('closetId') closetId: string) {
    return this.adminService.getClosetDetailForAdmin(closetId);
  }
}
