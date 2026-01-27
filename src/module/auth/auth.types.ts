import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsString } from 'class-validator';
// import { Role } from "@prisma/client"

export const Auth_Otp_Token_Subject = {
  Verify_Email: 'verify email',
  RESET_PASSWORD: 'RESET Password',
  CONFIRM_ORDER:"Verify Order "
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
  // // email:
  role:Role
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
  // role:Role
  email: string;
  isVerified: boolean;
  name: string;
}

export class ResendVerificationEmail {
  @ApiProperty()
  @IsEmail()
  email: string;
}
