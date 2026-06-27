import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetShopSaleProductsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  productIds: string[];
}
