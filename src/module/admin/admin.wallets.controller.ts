import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Query,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

@ApiTags('Admin Wallets')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/wallets')
export class AdminWalletsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get wallets and escrow statistics' })
  async getWalletStats() {
    return this.adminService.getWalletStats();
  }

  @Get()
  @ApiOperation({ summary: 'Get all wallets' })
  async getAllWallets(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getAllWallets(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get('escrow')
  @ApiOperation({ summary: 'Get all escrows' })
  async getAllEscrows(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllEscrows(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
      status,
      search,
    );
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get all wallet transactions' })
  async getAllTransactions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getAllWalletTransactions(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Post('export')
  @ApiOperation({ summary: 'Export wallet data' })
  async exportWallets() {
    return this.adminService.exportWallets();
  }

  @Put('escrow/:escrowId/release')
  @ApiOperation({ summary: 'Release escrow funds' })
  async releaseEscrow(
    @Param('escrowId') escrowId: string,
    @Body() data: { amount?: number; note: string },
  ) {
    return this.adminService.releaseEscrow(escrowId, data);
  }

  @Get('withdrawal-requests')
  @ApiOperation({ summary: 'Get all withdrawal requests' })
  async getWithdrawalRequests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllWithdrawals(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
      status,
      search,
    );
  }

  @Get('payouts')
  @ApiOperation({ summary: 'Get payouts' })
  async getPayouts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getPayouts(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
      search,
    );
  }

  @Put('withdrawal-requests/:id/paid')
  @ApiOperation({ summary: 'Mark withdrawal as paid' })
  async markWithdrawalAsPaid(
    @Param('id') id: string,
    @Body('trackingId') trackingId: string,
  ) {
    return this.adminService.markWithdrawalAsPaid(id, trackingId);
  }

  @Put('withdrawals/:id/status')
  @ApiOperation({ summary: 'Update withdrawal status' })
  async updateWithdrawalStatus(
    @Param('id') withdrawalId: string,
    @Body() data: { status: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    return this.adminService.updateWithdrawalStatus(
      withdrawalId,
      data.status,
      data.note,
    );
  }

  @Get(':walletId')
  @ApiOperation({ summary: 'Get wallet details' })
  async getWalletDetails(@Param('walletId') walletId: string) {
    return this.adminService.getWalletDetails(walletId);
  }
}
