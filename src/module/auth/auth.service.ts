import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { AuthOtpTokenType } from '@prisma/client';
import * as argon2 from 'argon2';
import { addMinutes, addHours, isAfter, subMinutes } from 'date-fns';
import { AuthOtpTokenService } from 'src/services/auth-otp-token/auth-otp-token.service';
import { Verification_Mail } from 'src/services/event/event.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { UserActivityService } from 'src/services/user-activity/user-activity.service';
import { bad, mustHave } from 'src/utils/error';
import {
  Auth_Otp_Token_Subject,
  forgotPasswordDto,
  loginDto,
  registerDto,
  ResendVerificationEmail,
  resetPasswordDto,
  userEntity,
  verifyEmailDto,
  verifyAdminMfaDto,
} from './auth.types';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authOtpTokenService: AuthOtpTokenService,
    private readonly userActivity: UserActivityService,
    private eventEmitter: EventEmitter2,
    private jwtService: JwtService,
  ) {}

  async register(dto: registerDto) {
    const { name, email, password } = dto;
    const normalizedEmail = email.trim().toLowerCase();
    const role =
      dto.role === Role.RENTER || dto.role === Role.LISTER
        ? dto.role
        : Role.RENTER;

    const hashedPassword = await argon2.hash(password);
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    let newUser;
    if (existing) {
      if (existing.provider !== 'guest') {
        bad('email already exists');
      }
      newUser = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          password: hashedPassword,
          passwordSetAt: new Date(),
          role,
          provider: null,
          isVerified: false,
        },
      });
    } else {
      try {
        newUser = await this.prisma.user.create({
          data: {
            name,
            email: normalizedEmail,
            password: hashedPassword,
            passwordSetAt: new Date(),
            role,
          },
        });
      } catch (error) {
        if (error.code === 'P2002') bad('email already exists');
        throw error;
      }
    }

    await this.sendVerificationEmail(normalizedEmail, name, newUser.id);

    return { message: 'User successfully registered' };
  }

  private async sendVerificationEmail(
    email: string,
    name: string,
    userId: string,
  ) {
    const expiryMinutes = 60;
    const expiry = addMinutes(Date.now(), expiryMinutes);

    await this.prisma.authOtpToken.deleteMany({
      where: {
        email,
        subject: Auth_Otp_Token_Subject.Verify_Email,
      },
    });

    const tokenRecord = await this.authOtpTokenService.createOtp({
      email,
      subject: Auth_Otp_Token_Subject.Verify_Email,
      userId,
      expiry,
      type: 'TOKEN',
    });

    const frontendUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const verificationLink = `${frontendUrl}/auth/verify-email?token=${tokenRecord.code}`;

    this.eventEmitter.emit('verification_mail', {
      email,
      code: tokenRecord.code,
      name,
      year: new Date().getFullYear(),
      verificationLink,
      expiryMinutes,
    });
  }

  // login in user
  async login(dto: loginDto, res) {
    const { email, password } = dto;
    // check if user exist in the database
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
    mustHave(user, 'invalid credentials', 401);

    if (user.provider === 'guest' && !user.passwordSetAt) {
      bad(
        'This account uses email login links. Use “Email me a login link” on the sign-in page.',
        401,
      );
    }

    const matched = await argon2.verify(user.password, password);
    if (!matched) bad('invalid credential');

    if (!user.passwordSetAt && user.provider !== 'guest') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordSetAt: user.createdAt ?? new Date() },
      });
    }

    if (!user.isVerified) {
      const existingToken = await this.prisma.authOtpToken.findFirst({
        where: {
          userId: user.id,
          subject: Auth_Otp_Token_Subject.Verify_Email,
        },
        orderBy: { createdAt: 'desc' },
      });

      const tokenStillValid =
        existingToken && !isAfter(new Date(), existingToken.expiry);
      const sentRecently =
        existingToken && existingToken.createdAt >= subMinutes(new Date(), 1);

      if (tokenStillValid) {
        bad(
          'Please verify your email. Check your inbox for the verification link.',
          401,
        );
      }

      if (sentRecently) {
        bad(
          'Please verify your email. Check your inbox for the verification link.',
          401,
        );
      }

      await this.prisma.authOtpToken.deleteMany({
        where: {
          userId: user.id,
          subject: Auth_Otp_Token_Subject.Verify_Email,
        },
      });

      const expiryMinutes = 60;
      const expiry = addMinutes(new Date(), expiryMinutes);
      const tokenRecord = await this.authOtpTokenService.createOtp({
        userId: user.id,
        type: AuthOtpTokenType.TOKEN,
        subject: Auth_Otp_Token_Subject.Verify_Email,
        email: user.email,
        expiry,
      });

      const frontendUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const verificationLink = `${frontendUrl}/auth/verify-email?token=${tokenRecord.code}`;
      const year = new Date().getFullYear();

      this.eventEmitter.emit('verification_mail', {
        email: user.email,
        code: tokenRecord.code,
        name: user.name,
        year,
        verificationLink,
        expiryMinutes,
      });

      bad(
        'A new verification link has been sent to your email. Please check your inbox.',
        401,
      );
    }

    // Check if user is admin - require MFA
    if (user.role === Role.ADMIN) {
      // Check for recent MFA OTP requests (rate limiting)
      const recentMfaOtp = await this.prisma.authOtpToken.findFirst({
        where: {
          userId: user.id,
          subject: Auth_Otp_Token_Subject.Admin_MFA,
          createdAt: {
            gte: subMinutes(new Date(), 1),
          },
        },
      });

      if (recentMfaOtp) {
        bad('Please wait before requesting another MFA code.', 429);
      }

      // Delete old admin MFA tokens
      await this.prisma.authOtpToken.deleteMany({
        where: {
          userId: user.id,
          subject: Auth_Otp_Token_Subject.Admin_MFA,
        },
      });

      // Create MFA OTP token
      const expiryMinutes = 10;
      const expiry = addMinutes(new Date(), expiryMinutes);
      const mfaTokenRecord = await this.authOtpTokenService.createOtp({
        userId: user.id,
        type: AuthOtpTokenType.OTP,
        subject: Auth_Otp_Token_Subject.Admin_MFA,
        email: user.email,
        expiry,
      });

      // Create temporary session token (short-lived, 10 minutes)
      const sessionPayload = {
        sub: user.id,
        email: user.email,
        sessionId: mfaTokenRecord.id,
        mfaRequired: true,
      };
      const sessionToken = await this.jwtService.signAsync(sessionPayload, {
        expiresIn: '10m',
      });

      // Send MFA OTP email
      const year = new Date().getFullYear();
      this.eventEmitter.emit('verification_mail', {
        email: user.email,
        code: mfaTokenRecord.code,
        name: user.name,
        year,
        expiryMinutes,
        adminMfa: true,
      });

      return {
        requiresMfa: true,
        sessionToken: sessionToken,
        message:
          'MFA code sent to your email. Please verify to complete login.',
      };
    }

    // Regular user login - no MFA required
    const tokenVersion = (user as { tokenVersion?: number }).tokenVersion ?? 0;
    const payload = {
      sub: user.id,
      email: user.email,
      v: tokenVersion,
      role: user.role,
    };
    const token = await this.jwtService.signAsync(payload);
    await this.userActivity.recordLogin(user.id);

    return {
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
      requiresMfa: false,
    };
  }

  async handleGoogleLogin(googleUser: {
    email: string;
    name: string;
    provider: string;
  }) {
    let user = await this.prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    //  create new user
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
          provider: googleUser.provider,
          role: Role.LISTER,
          password: '',
          isVerified: true,
        },
      });
    }

    const tokenVersion = (user as { tokenVersion?: number }).tokenVersion ?? 0;
    const payload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      v: tokenVersion,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    await this.userActivity.recordLogin(user.id);

    return {
      accessToken,
      user,
    };
  }

  // verify the email
  async verifyEmail(dto: verifyEmailDto) {
    // check if the email exist
    const otp = await this.authOtpTokenService.findCode(dto.code);
    if (!otp) bad('invalid token');

    // verify the code
    const isVerified = await this.authOtpTokenService.verifyOtp(
      {
        code: otp.code,
        subject: Auth_Otp_Token_Subject.Verify_Email,
      },
      false,
    );
    if (!isVerified) bad('otp verification failed');
    // update the user

    const user = await this.prisma.user.update({
      where: {
        email: otp.email,
      },
      data: {
        isVerified: true,
      },
    });
    await this.authOtpTokenService.deleteOtp(otp.id);
    return {
      message: 'email verified successfully ',
    };
  }

  /** One-tap login URL (token in query string; redirect path validated on the client). */
  async buildMagicLoginUrl(
    userId: string,
    email: string,
    redirectPath: string,
    expiryMinutes = 60,
  ): Promise<string> {
    await this.prisma.authOtpToken.deleteMany({
      where: {
        userId,
        subject: Auth_Otp_Token_Subject.MAGIC_LINK_LOGIN,
      },
    });

    const expiry = addMinutes(new Date(), expiryMinutes);
    const tokenRecord = await this.authOtpTokenService.createOtp({
      userId,
      email,
      subject: Auth_Otp_Token_Subject.MAGIC_LINK_LOGIN,
      expiry,
      type: 'TOKEN',
    });

    const frontendUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const redirect = redirectPath.startsWith('/')
      ? redirectPath
      : `/${redirectPath}`;

    return `${frontendUrl}/auth/magic-link?token=${tokenRecord.code}&redirect=${encodeURIComponent(redirect)}`;
  }

  async requestMagicLink(email: string, redirect?: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });

    if (!user) {
      return {
        success: true,
        message:
          'If an account with that email exists, a login link has been sent.',
      };
    }

    const recent = await this.prisma.authOtpToken.findFirst({
      where: {
        userId: user.id,
        subject: Auth_Otp_Token_Subject.MAGIC_LINK_LOGIN,
        createdAt: { gte: subMinutes(new Date(), 1) },
      },
    });
    if (recent) {
      return {
        success: true,
        message:
          'If an account with that email exists, a login link has been sent.',
      };
    }

    const safeRedirect =
      redirect && redirect.startsWith('/') && !redirect.startsWith('//')
        ? redirect
        : '/shop';

    const magicLink = await this.buildMagicLoginUrl(
      user.id,
      user.email,
      safeRedirect,
      60,
    );

    this.eventEmitter.emit('magic_link_mail', {
      email: user.email,
      name: user.name,
      year: new Date().getFullYear(),
      magicLink,
      expiryMinutes: 60,
    });

    return {
      success: true,
      message:
        'If an account with that email exists, a login link has been sent.',
    };
  }

  async consumeMagicLink(code: string) {
    const otp = await this.authOtpTokenService.findCode(code.trim());
    if (!otp) bad('This link is invalid or has expired');

    const valid = await this.authOtpTokenService.verifyOtp(
      {
        code: otp.code,
        subject: Auth_Otp_Token_Subject.MAGIC_LINK_LOGIN,
      },
      true,
    );
    if (!valid) bad('This link is invalid or has expired');

    let user = await this.prisma.user.findUnique({
      where: { id: otp.userId },
    });
    if (!user) bad('This link is invalid or has expired');

    if (!user.isVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      });
    }

    const tokenVersion = user.tokenVersion ?? 0;
    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      v: tokenVersion,
      role: user.role,
    });
    await this.userActivity.recordLogin(user.id);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
        passwordSetAt: user.passwordSetAt,
      },
      requiresMfa: false,
      passwordNotSet: user.passwordSetAt == null,
    };
  }

  // forget password - send password reset OTP via email
  async forgotPassword(dto: forgotPasswordDto) {
    const { email } = dto;

    // Find if the email exists
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Don't reveal if email exists (security best practice)
    if (!user) {
      // Return success even if user doesn't exist to prevent email enumeration
      return {
        success: true,
        message:
          'If an account with that email exists, a password reset code has been sent.',
      };
    }

    // Check for recent password reset requests (rate limiting - 1 per minute)
    const recentResetOtp = await this.prisma.authOtpToken.findFirst({
      where: {
        userId: user.id,
        subject: Auth_Otp_Token_Subject.RESET_PASSWORD,
        createdAt: {
          gte: subMinutes(new Date(), 1),
        },
      },
    });

    if (recentResetOtp) {
      return {
        success: false,
        message: 'Please wait before requesting another password reset code.',
      };
    }

    // Delete old password reset tokens for this user
    await this.prisma.authOtpToken.deleteMany({
      where: {
        userId: user.id,
        subject: Auth_Otp_Token_Subject.RESET_PASSWORD,
      },
    });

    // Create new password reset OTP token (expires in 10 minutes)
    const expiryMinutes = 10;
    const expiry = addMinutes(new Date(), expiryMinutes);
    const otpCode = await this.authOtpTokenService.createOtp({
      userId: user.id,
      type: AuthOtpTokenType.OTP,
      subject: Auth_Otp_Token_Subject.RESET_PASSWORD,
      email: email,
      expiry,
    });

    const year = new Date().getFullYear();

    // Send password reset email via event emitter
    this.eventEmitter.emit('password_reset_mail', {
      email: email,
      code: otpCode.code,
      name: user.name,
      year: year,
      expiryMinutes: expiryMinutes,
    });

    return {
      success: true,
      message:
        'If an account with that email exists, a password reset code has been sent.',
    };
  }

  // resend code
  async resendOtpCode(dto: ResendVerificationEmail) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) return;

    if (user.isVerified) bad('account already verified');

    //  Check for recent OTP requests
    const recentOtp = await this.prisma.authOtpToken.findFirst({
      where: {
        userId: user.id,
        subject: Auth_Otp_Token_Subject.Verify_Email,
        createdAt: {
          gte: subMinutes(new Date(), 1),
        },
      },
    });
    if (recentOtp) {
      return {
        success: false,
        message: 'Please wait before requesting another code',
      };
    }

    const expiryMinutes = 60;
    const expiry = addMinutes(new Date(), expiryMinutes);

    await this.prisma.authOtpToken.deleteMany({
      where: {
        userId: user.id,
        subject: Auth_Otp_Token_Subject.Verify_Email,
      },
    });

    const tokenRecord = await this.authOtpTokenService.createOtp({
      userId: user.id,
      type: AuthOtpTokenType.TOKEN,
      subject: Auth_Otp_Token_Subject.Verify_Email,
      email: dto.email,
      expiry,
    });

    const frontendUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const verificationLink = `${frontendUrl}/auth/verify-email?token=${tokenRecord.code}`;
    const year = new Date().getFullYear();

    this.eventEmitter.emit('verification_mail', {
      email: dto.email,
      code: tokenRecord.code,
      name: user.name,
      year,
      verificationLink,
      expiryMinutes,
    });

    return {
      success: true,
      message: 'Verification email sent. Check your inbox.',
    };
  }

  // reset password
  async resetPassword(dto: resetPasswordDto) {
    const { code, password } = dto;

    // find and verify the token
    const token = await this.authOtpTokenService.findCode(code);

    if (!token) bad('invalid token');

    const tokenIsValid = await this.authOtpTokenService.verifyOtp(
      {
        code: token.code,
        subject: Auth_Otp_Token_Subject.RESET_PASSWORD,
      },
      false,
    );
    if (!tokenIsValid) bad('invalid token');

    const updateUserPassword = await this.prisma.user.update({
      where: {
        email: token.email,
      },
      data: {
        password: await argon2.hash(password),
        passwordSetAt: new Date(),
      },
    });
    // delete the token
    await this.authOtpTokenService.deleteOtp(token.id);
    return {
      message: 'password reset successful',
    };
  }

  // find user
  async authUser(user: userEntity) {
    return user;
  }

  // logout: invalidate all tokens for this user by bumping tokenVersion
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { message: 'Logged out successfully' };
  }

  // Verify admin MFA and complete login
  async verifyAdminMfa(dto: verifyAdminMfaDto) {
    const { code, sessionToken } = dto;

    // Verify session token
    let sessionPayload: any;
    try {
      sessionPayload = await this.jwtService.verifyAsync(sessionToken, {
        secret: process.env.JWT_SECRET,
      });
    } catch (error) {
      bad('Invalid or expired session. Please login again.', 401);
    }

    if (!sessionPayload.mfaRequired || !sessionPayload.sessionId) {
      bad('Invalid session.', 401);
    }

    // Find the MFA token by sessionId
    const mfaToken = await this.prisma.authOtpToken.findUnique({
      where: { id: sessionPayload.sessionId },
      include: { user: true },
    });

    if (
      !mfaToken ||
      mfaToken.subject !== Auth_Otp_Token_Subject.Admin_MFA ||
      mfaToken.code !== code
    ) {
      bad('Invalid or expired MFA code.', 401);
    }

    // Check if token has expired
    if (isAfter(new Date(), mfaToken.expiry)) {
      await this.authOtpTokenService.deleteOtp(mfaToken.id);
      bad('MFA code has expired. Please login again.', 401);
    }

    // Delete the token after successful verification
    await this.authOtpTokenService.deleteOtp(mfaToken.id);

    // Verify user is still admin
    const user = await this.prisma.user.findUnique({
      where: { id: mfaToken.userId },
    });

    if (!user || user.role !== Role.ADMIN) {
      bad('User is not an admin.', 403);
    }

    // Issue full access token
    const tokenVersion = (user as { tokenVersion?: number }).tokenVersion ?? 0;
    const payload = {
      sub: user.id,
      email: user.email,
      v: tokenVersion,
      role: user.role,
    };
    const token = await this.jwtService.signAsync(payload);
    await this.userActivity.recordLogin(user.id);

    return {
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
      message: 'MFA verified successfully.',
    };
  }

  // Check if user needs dashboard selection (is admin)
  // Called after authentication via Auth decorator
  async checkDashboardSelectionByUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isVerified: true,
      },
    });

    if (!user) {
      bad('User not found.', 404);
    }

    return {
      isAdmin: user.role === Role.ADMIN,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
    };
  }
}
