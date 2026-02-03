import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  forgotPasswordDto,
  loginDto,
  registerDto,
  ResendVerificationEmail,
  resetPasswordDto,
  userEntity,
  verifyEmailDto,
  verifyAdminMfaDto,
} from './auth.types';
import { Auth, AuthUser } from './decorator/auth.decorator';

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
  loginUser(@Body() dto: loginDto,@Res({passthrough:true}) res:Response) {
    return this.authService.login(dto,res);
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

  @Auth()
  @ApiBearerAuth('token')
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        message: 'user authenticated',
      },
    },
  })
  @ApiBadRequestResponse({
    schema: {
      example: {
        success: false,
        message: 'unAuthourized',
      },
    },
  })
  @Get('/user')
  async getUser(@AuthUser() user: userEntity) {
    return await this.authService.authUser(user);
  }

  @Auth()
  @Post('logout')
  @ApiOperation({ summary: 'Log out and invalidate all tokens for this user' })
  @ApiOkResponse({
    description: 'Logged out successfully',
    schema: { example: { message: 'Logged out successfully' } },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async logout(@AuthUser() user: userEntity) {
    return this.authService.logout(user.id);
  }

  @Post('verify-admin-mfa')
  @ApiOperation({ summary: 'Verify admin MFA OTP and complete login' })
  @ApiOkResponse({
    description: 'MFA verified successfully',
    schema: {
      example: {
        success: true,
        token: 'jwt_token_here',
        user: {
          id: 'uuid',
          email: 'admin@email.com',
          role: 'ADMIN',
        },
        message: 'MFA verified successfully.',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired MFA code',
    schema: {
      example: {
        success: false,
        message: 'Invalid or expired MFA code.',
      },
    },
  })
  async verifyAdminMfa(@Body() dto: verifyAdminMfaDto) {
    return this.authService.verifyAdminMfa(dto);
  }

  @Auth()
  @ApiBearerAuth('token')
  @Get('check-dashboard-selection')
  @ApiOperation({
    summary: 'Check if user needs to select dashboard (admin role)',
  })
  @ApiOkResponse({
    description: 'Dashboard selection status',
    schema: {
      example: {
        isAdmin: true,
        user: {
          id: 'uuid',
          email: 'admin@email.com',
          role: 'ADMIN',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired token',
    schema: {
      example: {
        success: false,
        message: 'Invalid or expired token.',
      },
    },
  })
  async checkDashboardSelection(@AuthUser() user: userEntity) {
    const fullUser = await this.authService.checkDashboardSelectionByUser(
      user.id,
    );
    return fullUser;
  }
}
