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

  @IsString()
  @IsOptional()
  requestType?: string;
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

  @IsString()
  @IsOptional()
  requestType?: string;
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

  @IsString()
  @IsOptional()
  requestType?: string;
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

export class ReturnInitiatedDto {
  @IsEmail()
  email: string;
  @IsString()
  curatorName: string;
  @IsString()
  renterName: string;
  @IsString()
  renterEmail: string;
  @IsString()
  renterPhone: string;
  @IsString()
  renterAddress: string;
  @IsString()
  orderId: string;
  @IsString()
  itemCondition: string;
  @IsString()
  @IsOptional()
  damageNotes?: string;
  @IsString()
  platformName: string;
}

export class ReturnCompletedDto {
  @IsEmail()
  email: string;
  @IsString()
  renterName: string;
  @IsString()
  orderId: string;
  @IsString()
  listerCondition: string;
  @IsString()
  @IsOptional()
  listerDamageNotes?: string;
  @IsNumber()
  collateralReleased: number;
  @IsString()
  @IsOptional()
  walletUrl?: string;
  @IsString()
  platformName: string;
}

export class DisputeCreatedDto {
  @IsEmail()
  email: string;

  @IsString()
  adminName: string;

  @IsString()
  disputeId: string;

  @IsString()
  orderId: string;

  @IsString()
  raisedByName: string;

  @IsString()
  raisedByRole: string;

  @IsString()
  category: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  adminLink?: string;
}

export class DisputeStatusDto {
  @IsEmail()
  email: string;

  @IsString()
  userName: string;

  @IsString()
  disputeId: string;

  @IsString()
  orderId: string;

  @IsString()
  status: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  preferredResolution?: string;

  @IsString()
  @IsOptional()
  disputeLink?: string;

  @IsNumber()
  @IsOptional()
  collateralWithheldToLister?: number;

  @IsNumber()
  @IsOptional()
  collateralReturnedToRenter?: number;

  @IsNumber()
  @IsOptional()
  compensationToLister?: number;
}

export class DisputeMessageDto {
  @IsEmail()
  email: string;

  @IsString()
  recipientName: string;

  @IsString()
  senderName: string;

  @IsString()
  disputeId: string;

  @IsString()
  orderId: string;

  @IsString()
  @IsOptional()
  messagePreview?: string;

  @IsString()
  @IsOptional()
  threadLink?: string;
}
