import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guard/authGuard';
import { AuthService } from './auth.service';
import {
  forgotPasswordDto,
  loginDto,
  registerDto,
  resetPasswordDto,
  verifyEmailDto,
  ResendVerificationEmail
} from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('signup')
  createUser(@Body() dto: registerDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  loginUser(@Body() dto: loginDto) {
    return this.authService.login(dto);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: verifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: forgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: resetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  
  @Post('resend-otp')
  async resendOtp(@Body() dto: ResendVerificationEmail) {

    return await this.authService.resendOtpCode(dto);
  }
}
