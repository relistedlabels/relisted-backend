import { Body, Controller, Headers, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RegisterVaultClosetSaleInterestDto } from './dto/register-vault-closet-sale-interest.dto';
import { VaultClosetSaleInterestService } from './vault-closet-sale-interest.service';

@ApiTags('Public - Vault Closet Sale')
@Controller('api/public/vault-closet-sale')
export class VaultClosetSaleInterestController {
  constructor(
    private readonly vaultClosetSaleInterestService: VaultClosetSaleInterestService,
  ) {}

  @Post('interest')
  @ApiOperation({
    summary: 'Register interest in the Vault Closet sale (notify by email)',
  })
  @ApiResponse({
    status: 201,
    description: 'Interest recorded or already registered',
  })
  @ApiBadRequestResponse({ description: 'Invalid email' })
  register(
    @Body() dto: RegisterVaultClosetSaleInterestDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.vaultClosetSaleInterestService.register(dto, authorization);
  }
}
