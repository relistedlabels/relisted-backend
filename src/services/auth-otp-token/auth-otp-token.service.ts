import { Injectable } from '@nestjs/common';
import { isAfter } from 'date-fns';
import { randomUUID } from 'crypto';
import { bad } from 'src/utils/error';
import { generateOtp } from 'src/utils/generateOtp';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAuthOtpTokenDto,
  VerifyOtp,
} from './dto/create-auth-otp-token.dto';

@Injectable()
export class AuthOtpTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async findCode(code: string) {
    return this.prisma.authOtpToken.findUnique({
      where: {
        code,
      },
    });
  }

  async createOtp(createAuthOtpTokenDto: CreateAuthOtpTokenDto) {
    const { subject, email, type, expiry, userId } = createAuthOtpTokenDto;
    const code = type === 'OTP' ? generateOtp() : randomUUID();
    //  create the token
    const otp = await this.prisma.authOtpToken.create({
      data: {
        subject,
        email,
        type,
        expiry,
        userId,
        code,
      },
    });
    return otp;
  }

  // verify otp
  async verifyOtp(dto: VerifyOtp, allowDelete: boolean = true) {
    // find if the otp exist  in the database
    const { code, subject } = dto;
    const token = await this.prisma.authOtpToken.findUnique({
      where: {
        code,
        subject,
      },
    });

    if (!token) {
      bad('invalid token');
    }

    // check if it have not expired
    const isExpired = isAfter(new Date(), token.expiry);
    // delete the token if it have expired
    if (isExpired) {
      await this.deleteOtp(token.id);
      return false;
    }
    if (allowDelete) {
      await this.deleteOtp(token.id);
    }
    return true;
  }

  async deleteOtp(id: string) {
    return await this.prisma.authOtpToken.delete({
      where: {
        id,
      },
    });
  }
}
