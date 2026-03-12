import { Controller, Get, Post, Body, UseGuards, Request, Query, Param } from '@nestjs/common';
import { ListersService } from './listers.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Listers Wallet')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.LISTER)
@Controller('api/listers/wallet')
export class ListersWalletController {
  constructor(private readonly listersService: ListersService) {}

  @Get()
  @ApiOperation({ summary: 'Get wallet balance and info' })
  async getWallet(@Request() req) {
    return this.listersService.getWallet(req.user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get wallet transactions' })
  async getWalletTransactions(@Request() req, @Query() query: any) {
    return this.listersService.getWalletTransactions(req.user.id, query);
  }

  @Get('bank-accounts')
  @ApiOperation({ summary: 'Get linked bank accounts' })
  async getBankAccounts(@Request() req) {
    return this.listersService.getBankAccounts(req.user.id);
  }

  @Get('locked-balances')
  @ApiOperation({ summary: 'Get locked balances breakdown' })
  async getLockedBalances(@Request() req) {
    return this.listersService.getLockedBalances(req.user.id);
  }

  @Get('withdraw/:withdrawalId')
  @ApiOperation({ summary: 'Get withdrawal details' })
  async getWithdrawal(@Request() req, @Param('withdrawalId') withdrawalId: string) {
    return this.listersService.getWithdrawal(req.user.id, withdrawalId);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Request wallet withdrawal' })
  async requestWithdrawal(@Request() req, @Body() body: { amount: number, bankAccountId: string }) {
    return this.listersService.requestWithdrawal(req.user.id, body);
  }
}
