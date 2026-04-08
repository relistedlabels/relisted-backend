import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsString } from 'class-validator';
// import { Role } from "@prisma/client"

export const Auth_Otp_Token_Subject = {
  Verify_Email: 'verify email',
  RESET_PASSWORD: 'RESET Password',
  CONFIRM_ORDER: 'Verify Order ',
  Admin_MFA: 'admin mfa',
  RENTAL_REQUEST: 'New Rental Request',
  RENTAL_REQUEST_WITHDRAWN: 'Rental request withdrawn',
  RENTAL_RESPONSE: 'Update on your Rental Request',
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

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;
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
