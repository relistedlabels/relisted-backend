import { AuthOtpTokenType } from '@prisma/client';
import { IsDate, IsEnum, IsString, IsUUID } from 'class-validator';

export class CreateAuthOtpTokenDto {
  @IsString()
  subject: string;
  @IsEnum(AuthOtpTokenType)
  type: AuthOtpTokenType;
  @IsDate()
  expiry: Date;
  @IsString()
  email: string;

  @IsUUID('4')
  @IsString()
  userId: string;
}

export class VerifyOtp {
  @IsString()
  code: string;
  @IsString()
  subject: string;
}
