import { Controller, Get, Param, Post, Body, Query, Put } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';

@ApiTags('Admin Wallets')
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
  ) {
    return this.adminService.getAllEscrows(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
      status,
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

  @Get(':walletId')
  @ApiOperation({ summary: 'Get wallet details' })
  async getWalletDetails(@Param('walletId') walletId: string) {
    return this.adminService.getWalletDetails(walletId);
  }
}
