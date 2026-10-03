import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
// import { Role } from "@prisma/client"

export const Auth_Otp_Token_Subject = {
  Verify_Email: 'verify email',
  RESET_PASSWORD: 'RESET Password',
  CONFIRM_ORDER: 'Order confirmed on Relisted',
  ORDER_AWAITING_APPROVAL: 'Order awaiting your approval on Relisted',
  LISTER_ORDER_PLACED: 'New order on Relisted',
  Admin_MFA: 'Your admin login code',
  RENTAL_REQUEST: 'New Rental Request',
  PURCHASE_REQUEST: 'New Purchase Request',
  RENTAL_REQUEST_WITHDRAWN: 'Rental request withdrawn',
  PURCHASE_REQUEST_WITHDRAWN: 'Purchase request withdrawn',
  RENTAL_RESPONSE: 'Update on your Rental Request',
  PURCHASE_RESPONSE: 'Update on your Purchase Request',
  AVAILABILITY_REMINDER_REREQUEST: 'Reminder: send a new request on Relisted',
  AVAILABILITY_REMINDER_AVAILABLE: 'A lister is ready for your request',
  AVAILABILITY_CHECKOUT_REMINDER: 'Complete your approved request on Relisted',
  AVAILABILITY_EXPIRED_LISTER_REMINDER:
    'You missed a request on Relisted',
  WITHDRAWAL_STATUS: 'Withdrawal Request Status',
  SHIPPING_UPDATE: 'Shipping Status Update',
  ORDER_CANCELLED: 'Your order was cancelled',
  ORDER_CANCELLED_LISTER: 'An order was cancelled',
  AVAILABILITY_STATUS: 'Availability request status',
  LISTER_AVAILABILITY_RESPONSE: 'Lister availability response',
  MAGIC_LINK_LOGIN: 'Sign in to Relisted',
};

export class registerDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  password: string;

  @ApiProperty({ enum: Role, required: false })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class loginDto {
  @ApiProperty()
  @IsEmail()
  email: string;
  @ApiProperty()
  @IsString()
  password: string;
}

export class verifyEmailDto {
  @ApiProperty()
  @IsString()
  code: string;
}

export class resetPasswordDto {
  @ApiProperty()
  @IsString()
  code: string;
  @ApiProperty()
  @IsString()
  password: string;
  @ApiProperty()
  @IsString()
  email: string;
}

export class forgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class userEntity {
  id: string;
  sub: string;
  email: string;
  isVerified: boolean;
  name: string;
  role: Role;
}

export class ResendVerificationEmail {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class requestMagicLinkDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  redirect?: string;
}

export class consumeMagicLinkDto {
  @ApiProperty()
  @IsString()
  code: string;
}

export class verifyAdminMfaDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  sessionToken: string;
}
