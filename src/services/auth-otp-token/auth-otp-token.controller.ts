import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AuthOtpTokenService } from './auth-otp-token.service';
import { CreateAuthOtpTokenDto, VerifyOtp } from './dto/create-auth-otp-token.dto';


@Controller('auth-otp-token')
export class AuthOtpTokenController {
  constructor(private readonly authOtpTokenService: AuthOtpTokenService) {}

  @Post()
  create(@Body() createAuthOtpTokenDto: CreateAuthOtpTokenDto) {
    return this.authOtpTokenService.createOtp(createAuthOtpTokenDto);
  }

 

  
 
}
