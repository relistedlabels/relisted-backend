import { IsNumber, IsString } from 'class-validator';

export class CreateCartItemDto {
  @IsString()
  productId: string;

  @IsNumber()
  days: number;
}
