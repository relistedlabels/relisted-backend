import { PartialType } from '@nestjs/swagger';
import { CreateShopSaleDto } from './create-shop-sale.dto';

export class UpdateShopSaleDto extends PartialType(CreateShopSaleDto) {}
