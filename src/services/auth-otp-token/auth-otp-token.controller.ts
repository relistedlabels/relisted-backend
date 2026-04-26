import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from 'src/module/auth/guard/authGuard';
import { RoleGuard } from 'src/module/auth/guard/roleGuard';
import { Roles } from 'src/module/auth/decorator/roles.decorator';
import { AuthOtpTokenService } from './auth-otp-token.service';
import {
  CreateAuthOtpTokenDto,
  VerifyOtp,
} from './dto/create-auth-otp-token.dto';

@ApiTags('Auth OTP Token')
@ApiBearerAuth('bearer')
@Controller('auth-otp-token')
export class AuthOtpTokenController {
  constructor(private readonly authOtpTokenService: AuthOtpTokenService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  async create(@Body() createAuthOtpTokenDto: CreateAuthOtpTokenDto) {
    const otp = await this.authOtpTokenService.createOtp(createAuthOtpTokenDto);
    return { success: true, data: { id: otp.id, createdAt: otp.createdAt } };
  }
}
