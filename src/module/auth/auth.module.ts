import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthOtpTokenModule } from 'src/services/auth-otp-token/auth-otp-token.module';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'google' }),
    AuthOtpTokenModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '1d',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService,GoogleStrategy],
  exports: [PassportModule],
})
export class AuthModule {}
