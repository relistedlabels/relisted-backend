import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { PaginationQuery } from 'src/utils/paginate-query';
import { ListingType } from '@prisma/client';

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

  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Collateral price must be 0 or greater' })
  @IsOptional()
  collateralPrice?: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Daily price must be 0 or greater' })
  @IsOptional()
  dailyPrice?: number;

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

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagids?: string[];

  @ApiProperty()
  @IsString()
  @IsOptional()
  brandId?: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  material?: string;

  @ApiProperty({
    enum: ListingType,
    description: 'Type of listing for this product',
    example: ListingType.RENTAL,
  })
  @IsEnum(ListingType, { message: 'Invalid listing type' })
  @IsOptional()
  listingType?: ListingType;

  @ApiProperty({
    description: 'Resale price for RESALE or BOTH listings (in NGN kobo)',
    example: 50000,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Resale price must be a number' })
  @Min(0, { message: 'Resale price must be 0 or greater' })
  @Type(() => Number)
  resalePrice?: number;
}
export class ListProductQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  brand?: string | string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPrice?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  material?: string;

  @IsOptional()
  @IsString()
  tags?: string;
}

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
  minPrice: number;
  @IsOptional()
  @IsNumber()
  maxPrice: number;

  @IsOptional()
  @IsBoolean()
  verified: boolean;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagids?: string[];

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  material?: string;
}

export class RejectProductDto {
  @ApiProperty({
    description: 'Reason for rejection',
    example: 'Product images are not clear enough',
  })
  @IsString()
  @IsNotEmpty({ message: 'Rejection comment is required' })
  rejectionComment: string;
}

export class ToggleAvailabilityDto {
  @ApiProperty({
    description: 'Set product availability',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  isAvailable: boolean;
}
