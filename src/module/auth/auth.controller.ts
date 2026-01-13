import { Body, Controller, Post, Req, UseGuards,Get,Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import {
  forgotPasswordDto,
  loginDto,
  registerDto,
  resetPasswordDto,
  verifyEmailDto,
  ResendVerificationEmail,
} from './auth.types';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('signup')
  @ApiCreatedResponse({
    description: 'User registered successfully',
    schema: {
      example: {
        success: true,
        message: 'Registration successful. OTP sent to email',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation or duplicate email error',
    schema: {
      example: {
        success: false,
        message: 'Email already exists',
      },
    },
  })
  createUser(@Body() dto: registerDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOkResponse({
    description: 'Login successful',
    schema: {
      example: {
        success: true,
        token: 'jwt_token_here',
        user: {
          id: 'uuid',
          email: 'user@email.com',
          role: 'USER',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials',
    schema: {
      example: {
        success: false,
        message: 'Invalid email or password',
      },
    },
  })
  loginUser(@Body() dto: loginDto) {
    return this.authService.login(dto);
  }


  
  @Get('google')
  @UseGuards(AuthGuard('google'))
   @ApiOperation({ summary: 'Redirect to Google OAuth login' })
  @ApiResponse({
    status: 302,
    description: 'Redirects the user to Google login page.',
  })
  async googleLogin() {
    // Redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))

 @ApiOperation({ summary: 'Handle Google OAuth callback' })
  @ApiResponse({
    status: 302,
    description:
      'Redirects to frontend with access token in query param after successful login.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized if login fails.' })
  async googleCallback(@Req() req, @Res() res) {
    const result = await this.authService.handleGoogleLogin(req.user);
    res.redirect(
      `http://localhost:5173/oauth-success?token=${result.accessToken}`,
    );
  }

  @Post('verify-otp')
  @ApiOkResponse({
    description: 'Email verified successfully',
    schema: {
      example: {
        success: true,
        message: 'Email verified successfully',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired OTP',
    schema: {
      example: {
        success: false,
        message: 'Invalid or expired OTP',
      },
    },
  })
  verifyOtp(@Body() dto: verifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('forgot-password')
  @ApiOkResponse({
    description: 'OTP sent to email',
    schema: {
      example: {
        success: true,
        message: 'Password reset OTP sent',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Email not found',
    schema: {
      example: {
        success: false,
        message: 'User not found',
      },
    },
  })
  forgotPassword(@Body() dto: forgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOkResponse({
    description: 'Password reset successful',
    schema: {
      example: {
        success: true,
        message: 'Password reset successful',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid OTP or password mismatch',
    schema: {
      example: {
        success: false,
        message: 'Invalid or expired OTP',
      },
    },
  })
  resetPassword(@Body() dto: resetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('resend-otp')
  @ApiOkResponse({
    description: 'OTP resent successfully',
    schema: {
      example: {
        success: true,
        message: 'Verification code resent',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Too many requests or already verified',
    schema: {
      example: {
        success: false,
        message: 'Please wait before requesting another code',
      },
    },
  })
  async resendOtp(@Body() dto: ResendVerificationEmail) {
    return await this.authService.resendOtpCode(dto);
  }
}
