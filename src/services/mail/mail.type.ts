import { IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';

export class VerificationDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  year: number;

  @IsString()
  @IsOptional()
  verificationLink?: string;

  @IsNumber()
  @IsOptional()
  expiryMinutes?: number;
}

export class VerifyOrderDto {
  @IsEmail()
  email: string;
  @IsString()
  curatorName: string;
  @IsString()
  renterName: string;
  @IsString()
  orderId: string;
  @IsNumber()
  totalAmount: number;
   @IsString()
  platformName: string;

  @IsString()
  approvalLink: string;
 

  @IsString()
  productName: string;
  @IsString()
  days: string;
  @IsNumber()
  price: number;
}
