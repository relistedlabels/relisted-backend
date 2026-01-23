import { PartialType } from '@nestjs/swagger';
import { CreateFundWalletDto } from './create-wema-service.dto';

export class UpdateWemaServiceDto extends PartialType(CreateFundWalletDto) {}
