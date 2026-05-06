import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';
import { Allow, IsArray, IsOptional } from 'class-validator';

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['closetId'] as const),
) {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Set null or empty string to remove closet assignment',
  })
  @Allow()
  @IsOptional()
  closetId?: string | null;

  @IsArray()
  @IsOptional()
  removeImages?: string[];

  @IsArray()
  @IsOptional()
  addImages?: string[];

  @IsArray()
  @IsOptional()
  keepImages?: string[];
}

// Note: You might want to exclude 'attachments' from parent
// since we're using keepImages/addImages/removeImages instead
// Or you can override it
//   @IsArray()
//   @IsOptional()
//   attachments?: never;
// Make attachments not usable in update
