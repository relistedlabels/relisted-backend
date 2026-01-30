import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQuery } from 'src/utils/paginate-query';

export class CreateProductDto {
  @ApiProperty()
  @IsString()
   @IsOptional()
  name: string;
  @ApiProperty()
  @IsString()
   @IsOptional()
  subText: string;
  @ApiProperty()
  @IsString()
  @IsOptional()
  description: string;
  @ApiProperty()
  @IsString()
  @IsOptional()
  condition: string;
  @ApiProperty()
  @IsString()
  @IsOptional()
  composition: string;
  @ApiProperty()
  @IsString()
  @IsOptional()
  measurement: string;


  @ApiProperty()
  @IsNumber()
   @IsOptional()
  originalValue: number;
  @ApiProperty()
  @IsNumber()
   @IsOptional()
  dailyPrice: number;


  // @ApiProperty()
  //  @IsString()
  // size:string

  @ApiProperty()
  @IsNumber()
   @IsOptional()
  quantity: number;

  @ApiProperty()
  @IsString()
   @IsOptional()
  color: string;
  @ApiProperty()
  @IsString()
  @IsOptional()
  warning: string;
  @ApiProperty()
  @IsString()
   @IsOptional()
  careInstruction: string;
  @ApiProperty()
  @IsString()
   @IsOptional()
  careSteps: string;

  @ApiProperty()
  @IsString()
   @IsOptional()
  stylingTip: string;

@ApiProperty({
  type: [String],
  description: 'Upload IDs',
  example: ['uuid'],
})
@IsOptional()
@IsArray()
@IsUUID('4', { each: true })
attachments?: string[];
  @ApiProperty()
  @IsString()
   @IsOptional()
  categoryId?: string;
  @ApiProperty()
  @IsString()
   @IsOptional()
  tagId?: string;
  @ApiProperty()
  @IsString()
   @IsOptional()
  brandId?: string;
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

export class queryDto {
  @IsOptional()
  @IsString()
  brandId: string;
  @IsOptional()
  @IsString()
  categoryId: string;
  @IsOptional()
  @IsString()
  tagId: string;
   @IsOptional()
  @IsNumber()
  minPrice:number
   @IsOptional()
  @IsNumber()
  maxPrice:number 

   @IsOptional()
  @IsBoolean()
  verified:boolean
}
