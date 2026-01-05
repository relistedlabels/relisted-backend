import { Module } from '@nestjs/common';
import { AuthOtpTokenService } from './auth-otp-token.service';
import { AuthOtpTokenController } from './auth-otp-token.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [AuthOtpTokenController],
  providers: [AuthOtpTokenService,PrismaService],
  exports:[AuthOtpTokenService]
})
export class AuthOtpTokenModule {}
