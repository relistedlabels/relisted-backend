import { IsEmail, IsNumber, IsString } from 'class-validator';

export class VerificationDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  year: number;
}

export class VerifyOrderDto {
  // @IsString()
  // curatorName: string;
  @IsString()
  name:string
  @IsString()
  orderId: string;
  @IsNumber()
  totalAmount: number;
  // @IsString()
  // rentalPeriod: string;
  // @IsString()
  // approvalLink: string;
  @IsString()
  platformName: string;
  
  @IsEmail()
  email:string
}
