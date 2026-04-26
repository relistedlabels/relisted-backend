import {
  Body,
  Controller,
  Delete,
  Get,
  BadRequestException,
  Param,
  Patch,
  Post,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
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
    const accountnumber = body?.accountnumber;
    if (
      accountnumber === undefined ||
      accountnumber === null ||
      String(accountnumber).trim() === ''
    ) {
      throw new BadRequestException('accountnumber is required');
    }
    return this.wemaServiceService.nameLookup(body);
  }

  @Post('transaction-notify')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async transactionNotify(@Body() body: any) {
    const craccount = body?.craccount;
    const sessionid = body?.sessionid;
    if (
      craccount === undefined ||
      craccount === null ||
      String(craccount).trim() === ''
    ) {
      throw new BadRequestException('craccount is required');
    }
    if (
      sessionid === undefined ||
      sessionid === null ||
      String(sessionid).trim() === ''
    ) {
      throw new BadRequestException('sessionid is required');
    }
    return this.wemaServiceService.transactionNotify(body);
  }

  @Post('mini-statement')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async fetchMiniStatement(@Body() body: any) {
    const accountnumber = body?.accountnumber;
    if (
      accountnumber === undefined ||
      accountnumber === null ||
      String(accountnumber).trim() === ''
    ) {
      throw new BadRequestException('accountnumber is required');
    }
    return this.wemaServiceService.fetchMiniStatement(body);
  }

  @Post('kyc-details')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async getKycDetails(@Body() body: any) {
    const accountnumber = body?.accountnumber;
    if (
      accountnumber === undefined ||
      accountnumber === null ||
      String(accountnumber).trim() === ''
    ) {
      throw new BadRequestException('accountnumber is required');
    }
    return this.wemaServiceService.getKycDetails(body);
  }

  @Post('block-account')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async blockAccount(@Body() body: any) {
    const accountnumber = body?.accountnumber;
    if (
      accountnumber === undefined ||
      accountnumber === null ||
      String(accountnumber).trim() === ''
    ) {
      throw new BadRequestException('accountnumber is required');
    }
    return this.wemaServiceService.blockAccount(body);
  }

  // ==========================================
  // TODO: Implement placeholders for wallet operations later
  // ==========================================

  @Post('fund')
  @UseGuards(WemaAuthGuard)
  @HttpCode(200)
  async fundWalletPlaceholder(@Body() body: any) {
    const userId = body?.userId;
    const amount = body?.amount;
    if (
      userId === undefined ||
      userId === null ||
      String(userId).trim() === ''
    ) {
      throw new BadRequestException('userId is required');
    }
    if (
      amount === undefined ||
      amount === null ||
      String(amount).trim() === ''
    ) {
      throw new BadRequestException('amount is required');
    }
    return this.wemaServiceService.fundWallet(body.userId, body.amount);
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
