import { IsEmail, IsNotEmpty } from 'class-validator';

export class RegisterShopSaleInterestDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
