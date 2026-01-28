import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsString } from 'class-validator';
import { PaginationQuery } from 'src/utils/paginate-query';

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  name: string;
  @ApiProperty()
  @IsString()
  subText: string;
  @ApiProperty()
  @IsString()
  description: string;
  @ApiProperty()
  @IsString()
  condition: string;
  @ApiProperty()
  @IsString()
  composition: string;
  @ApiProperty()
  @IsString()
  measurement: string;
  @ApiProperty()
  @IsNumber()
  originalValue: number;
  @ApiProperty()
  @IsNumber()
  dailyPrice:number
    @ApiProperty()
  @IsNumber()
  quantity:number
  @ApiProperty()
  @IsString()
  color: string;
  @ApiProperty()
  @IsString()
  warning: string;
  @ApiProperty()
  @IsString()
  careInstruction: string;
  @ApiProperty()
  @IsString()
  careSteps: string;
  
  @ApiProperty()
  @IsString()
  stylingTip: string;
  @ApiProperty()
  @IsArray()
  attachments: string[];
  @ApiProperty()
  @IsString()
  categoryId?:string;
   @ApiProperty()
  @IsString()
  tagId?:string;
  @ApiProperty()
  @IsString()
  brandId?:string;
}
export class ListProductQuery extends PaginationQuery {}

export class UpdateProductStatusDto {
  @ApiProperty()
  isActive: boolean;
}




export class CreateFavouriteDto {
  @ApiProperty()
  @IsString()
  productId: string;
}
