import { IsArray, IsNumber, IsString } from 'class-validator';
import { PaginationQuery } from 'src/utils/paginate-query';

export class CreateProductDto {
  @IsString()
  name: string;
  @IsString()
  subText: string;
  @IsString()
  description: string;
  @IsString()
  condition: string;
  @IsNumber()
  dailyPrice: number;
  @IsString()
  composition: string;
  @IsString()
  measurement: string;
  @IsNumber()
  originalValue: number;
  @IsArray()
  color: string[];
  @IsString()
  warning: string;
  @IsString()
  careInstruction: string;
  @IsArray()
  careSteps: string[];
  @IsString()
  stylingTip: string;
  @IsArray()
  attachments: string[];
  @IsString()
  categoryId: string;
  @IsString()
  brandId: string;
}
export class ListProductQuery extends PaginationQuery {}

export class UpdateProductStatusDto {
  isActive: boolean;
}

export class CreateFavouriteDto {
  @IsString()
  productId: string;
}
