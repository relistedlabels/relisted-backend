import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { PaginationQuery } from 'src/utils/paginate-query';

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Product name is required' })
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subtitle/short description is required' })
  subText: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  description: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Condition is required' })
  condition: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  composition: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Measurement/size is required' })
  measurement: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Original value must be 0 or greater' })
  @IsOptional()
  originalValue: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Daily price must be 0 or greater' })
  @IsNotEmpty({ message: 'Daily price is required' })
  dailyPrice: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Quantity must be 0 or greater' })
  @IsOptional()
  quantity: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Color is required' })
  color: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  warning: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Care instruction is required' })
  careInstruction: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  careSteps?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Styling tip is required' })
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
