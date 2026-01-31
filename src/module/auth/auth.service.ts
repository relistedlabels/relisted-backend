import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { AuthOtpTokenType } from '@prisma/client';
import * as argon2 from 'argon2';
import { addMinutes, addHours, subMinutes } from 'date-fns';
import { AuthOtpTokenService } from 'src/services/auth-otp-token/auth-otp-token.service';
import { Verification_Mail } from 'src/services/event/event.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
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
} from './auth.types';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authOtpTokenService: AuthOtpTokenService,
    private eventEmitter: EventEmitter2,
    private jwtService: JwtService,
  ) {}
  

async register(dto: registerDto) {
  const { name, email, password, role } = dto;

  
  let newUser;
  try {
    newUser = await this.prisma.user.create({
      data: {
        name,
        email,
        password: await argon2.hash(password),
        role,
        
      },
    });

  } catch (error) {
    if (error.code === 'P2002') bad('email already exists');
    throw error;
  }

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
    userId: newUser.id,
    expiry,
    type: 'TOKEN',
  });

  const frontendUrl =
    process.env.FRONTEND_URL || 'http://localhost:3000';
  const verificationLink = `${frontendUrl}/auth/verify-email?token=${tokenRecord.code}`;

  const mailPayload = {
    email,
    code: tokenRecord.code,
    name,
    year: new Date().getFullYear(),
    verificationLink,
    expiryMinutes,
  };
  this.eventEmitter.emit('verification_mail', mailPayload);

  return { message: 'User successfully registered' };
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

    const matched = await argon2.verify(user.password, password);
    if (!matched) bad('invalid credential');

    if (!user.isVerified) {
      bad('Please verify your email before signing in. Check your inbox for the verification link.', 401);
    }

    const tokenVersion = (user as { tokenVersion?: number }).tokenVersion ?? 0;
    const payload = { sub: user.id, email: user.email, v: tokenVersion };
    const token = await this.jwtService.signAsync(payload);
    
    // find the user hotel
    const userEntity = {
      sub: user.id,
      email: email,
    };



    return {
      token: token,
      user: user,
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

  // forget password
  async forgotPassword(dto: forgotPasswordDto) {
    const { email } = dto;
    // find if the email exist
    const emailExist = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
    if (!emailExist) bad('invalid credentials');
    //  create token  to send
    const otpCode = await this.authOtpTokenService.createOtp({
      userId: emailExist.id,
      type: AuthOtpTokenType.OTP,
      subject: 'forgot password',
      email: email,
      expiry: addMinutes(new Date(), 10),
    });
    const year = new Date().getFullYear();
    // listen to an event emitter

    await this.eventEmitter.emit(
      'verification_mail',
      new Verification_Mail(email, otpCode.code, emailExist.name, year),
    );
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

    const frontendUrl =
      process.env.FRONTEND_URL || 'http://localhost:3000';
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
}
