import { Module } from '@nestjs/common';
import { AuthOtpTokenService } from './auth-otp-token.service';
import { AuthOtpTokenController } from './auth-otp-token.controller';

@Module({
  controllers: [AuthOtpTokenController],
  providers: [AuthOtpTokenService],
  exports: [AuthOtpTokenService],
})
export class AuthOtpTokenModule {}
