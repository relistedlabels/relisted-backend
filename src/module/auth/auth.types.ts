import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
// import { Role } from "@prisma/client"

export const Auth_Otp_Token_Subject = {
  Verify_Email: 'verify email',
  RESET_PASSWORD: 'RESET Password',
  CONFIRM_ORDER: 'Verify Order ',
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
  WITHDRAWAL_STATUS: 'Withdrawal Request Status',
  SHIPPING_UPDATE: 'Shipping Status Update',
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

export class verifyAdminMfaDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  sessionToken: string;
}
