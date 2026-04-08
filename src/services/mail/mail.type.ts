import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

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

  @IsOptional()
  items?: any[];
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  year: number;

  @IsNumber()
  @IsOptional()
  expiryMinutes?: number;
}

export class RentalRequestDto {
  @IsEmail()
  email: string;
  @IsString()
  renterName: string;
  @IsString()
  listerName: string;
  @IsString()
  productName: string;
  @IsString()
  requestId: string;
  @IsNumber()
  rentalDays: number;
  @IsNumber()
  totalPrice: number;
  @IsString()
  startDate: string;
  @IsString()
  endDate: string;
  @IsString()
  @IsOptional()
  viewLink?: string;

  @IsBoolean()
  @IsOptional()
  withdrawn?: boolean;

  @IsBoolean()
  @IsOptional()
  afterApproval?: boolean;
}

export class RentalResponseDto {
  @IsEmail()
  email: string;
  @IsString()
  renterName: string;
  @IsString()
  listerName: string;
  @IsString()
  productName: string;
  @IsString()
  status: string;
  @IsString()
  @IsOptional()
  reason?: string;
  @IsString()
  @IsOptional()
  checkoutLink?: string;
}

export class WithdrawalDto {
  @IsEmail()
  email: string;
  @IsString()
  userName: string;
  @IsNumber()
  amount: number;
  @IsString()
  reference: string;
  @IsString()
  status: string;
  @IsString()
  @IsOptional()
  bankName?: string;
  @IsString()
  @IsOptional()
  accountNumber?: string;
}

export class ShippingDto {
  @IsEmail()
  email: string;
  @IsString()
  userName: string;
  @IsString()
  orderId: string;
  @IsString()
  status: string;
  @IsString()
  @IsOptional()
  trackingNumber?: string;
  @IsString()
  @IsOptional()
  estimatedDelivery?: string;
}
