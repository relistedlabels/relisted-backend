import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, HttpCode } from '@nestjs/common';
import { CreateFundWalletDto } from './dto/create-wema-service.dto';
import { UpdateWemaServiceDto } from './dto/update-wema-service.dto';
import { WemaServiceService } from './wema-service.service';
import { WemaAuthGuard } from './wema-auth.guard';

@Controller('wallet/wema')
export class WemaServiceController {
  constructor(private readonly wemaServiceService: WemaServiceService) {}

  @Post('name-lookup')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async nameLookup(@Body() body: any) {
    return this.wemaServiceService.nameLookup(body);
  }

  @Post('transaction-notify')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async transactionNotify(@Body() body: any) {
    return this.wemaServiceService.transactionNotify(body);
  }

  @Post('mini-statement')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async fetchMiniStatement(@Body() body: any) {
    return this.wemaServiceService.fetchMiniStatement(body);
  }

  @Post('kyc-details')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async getKycDetails(@Body() body: any) {
    return this.wemaServiceService.getKycDetails(body);
  }

  @Post('block-account')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async blockAccount(@Body() body: any) {
    return this.wemaServiceService.blockAccount(body);
  }

  // ==========================================
  // TODO: Implement placeholders for wallet operations later
  // ==========================================

  @Post('fund')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async fundWalletPlaceholder(@Body() body: any) {
    return this.wemaServiceService.fundWalletPlaceholder(body);
  }

  @Post('remove-money')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async removeMoneyPlaceholder(@Body() body: any) {
    return this.wemaServiceService.removeMoneyPlaceholder(body);
  }

  @Get('transactions')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async getTransactionsPlaceholder(@Body() body: any) {
    // Note: GET requests shouldn't typically use body. Better to use Query parameters.
    // For now, keeping signature simple for the placeholder.
    const page = body?.page || 1;
    const limit = body?.limit || 10;
    return this.wemaServiceService.getTransactionsPlaceholder(page, limit);
  }

  @Get('balance')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async getWalletBalancePlaceholder() {
    return this.wemaServiceService.getWalletBalancePlaceholder();
  }
}
