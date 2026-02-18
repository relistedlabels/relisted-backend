import { Controller, Get, Post, Body, UseGuards, Request, Query, Param } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Wallet')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/wallet')
export class RentersWalletController {
  constructor(private readonly rentersService: RentersService) {}

  @Get()
  @ApiOperation({ summary: 'Get wallet balance and info' })
  async getWallet(@Request() req) {
    return this.rentersService.getWallet(req.user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get wallet transactions' })
  async getWalletTransactions(@Request() req, @Query() query: any) {
    return this.rentersService.getWalletTransactions(req.user.id, query);
  }

  @Get('bank-accounts')
  @ApiOperation({ summary: 'Get linked bank accounts' })
  async getBankAccounts(@Request() req) {
    return this.rentersService.getBankAccounts(req.user.id);
  }

  @Get('locked-balances')
  @ApiOperation({ summary: 'Get locked balances breakdown' })
  async getLockedBalances(@Request() req) {
    return this.rentersService.getLockedBalances(req.user.id);
  }

  @Get('withdraw/:withdrawalId')
  @ApiOperation({ summary: 'Get withdrawal details' })
  async getWithdrawal(@Request() req, @Param('withdrawalId') withdrawalId: string) {
    return this.rentersService.getWithdrawal(req.user.id, withdrawalId);
  }

  // Supported POST endpoints (deposit, withdraw, add bank account) are EXCLUDED per instructions?
  // User spec said: "excluded the post wallet endpoints"
  // But also said: "implement the following renter routes, excluding the post wallet endpoints"
  // So I skip POST /api/renters/wallet/deposit, POST /api/renters/wallet/bank-accounts, POST /api/renters/wallet/withdraw
}
