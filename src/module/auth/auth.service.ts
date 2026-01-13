import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { AuthOtpTokenType } from '@prisma/client';
import * as argon2 from 'argon2';
import { addMinutes, subMinutes } from 'date-fns';
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
  // check if user already exist before registering them
  async register(dto: registerDto) {
    const { name, email, password ,role} = dto;
    // check if user already exist in the database
    const emailExist = await this.prisma.user.findUnique({
      where: { email },
    });
    if (emailExist) bad('email already exist');

    // create new user
    const newUser = await this.prisma.user.create({
      data: {
        name,
        email,
        password: await argon2.hash(password),
        role  
      },
    });
    // creating otp to verify email
    const otpGenerated = await this.authOtpTokenService.createOtp({
      email: email,
      subject: Auth_Otp_Token_Subject.Verify_Email,
      userId: newUser.id,
      expiry: addMinutes(Date.now(), 10),
      type: 'OTP',
    });

    const year = new Date().getFullYear();
    // LISTEN  TO THE EVENT
    this.eventEmitter.emit(
      'verification_mail',
      new Verification_Mail(email, otpGenerated.code, name, year),
    );
    return {
      message: 'user successfully registered',
    };
  }

  // login in user
  async login(dto: loginDto) {
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

    // jwt token
    const payload = { sub: user.id, email: user.email };
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
          role: Role.DRESSER,
          password: '',
          isVerified: true,
        },
      });
    }

    const payload = {
      sub: user.id,
      role: user.role,
      email: user.email,
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
    await this.prisma.authOtpToken.deleteMany({
      where: {
        userId: user.id,
        subject: Auth_Otp_Token_Subject.Verify_Email,

        expiry: { lt: new Date() },
      },
    });
    const otpCode = await this.authOtpTokenService.createOtp({
      userId: user.id,
      type: AuthOtpTokenType.OTP,
      subject: Auth_Otp_Token_Subject.Verify_Email,
      email: dto.email,
      expiry: addMinutes(new Date(), 10),
    });
    // listen to an event emitter
    const year = new Date().getFullYear();
    await this.eventEmitter.emit(
      'verification_mail',
      new Verification_Mail(dto.email, otpCode.code, user.name, year),
    );
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
    console.log('user', user);

    return await this.prisma.user.findUnique({
      where: {
        id: user.sub,
      },
    });
  }
}
