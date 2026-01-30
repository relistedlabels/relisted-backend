import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';
import { IsArray, IsOptional } from 'class-validator';

export class UpdateProductDto extends PartialType(CreateProductDto) {
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
