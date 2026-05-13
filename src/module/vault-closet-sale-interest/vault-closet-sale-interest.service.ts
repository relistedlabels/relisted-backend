import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { RegisterVaultClosetSaleInterestDto } from './dto/register-vault-closet-sale-interest.dto';

@Injectable()
export class VaultClosetSaleInterestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  /** When Bearer token matches the submitted email, return user id for attribution. */
  private async resolveUserIdFromOptionalAuth(
    authorization: string | undefined,
    normalizedEmail: string,
  ): Promise<string | undefined> {
    if (!authorization?.startsWith('Bearer ')) {
      return undefined;
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      return undefined;
    }
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; v?: number }>(
        token,
        { secret: process.env.JWT_SECRET },
      );
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, tokenVersion: true },
      });
      if (!user) {
        return undefined;
      }
      const tokenVersion = payload.v ?? 0;
      if (user.tokenVersion !== tokenVersion) {
        return undefined;
      }
      if (user.email.toLowerCase() !== normalizedEmail) {
        return undefined;
      }
      return user.id;
    } catch {
      return undefined;
    }
  }

  async register(
    dto: RegisterVaultClosetSaleInterestDto,
    authorization?: string,
  ) {
    const email = this.normalizeEmail(dto.email);
    const userId = await this.resolveUserIdFromOptionalAuth(
      authorization,
      email,
    );

    const existing = await this.prisma.vaultClosetSaleInterest.findUnique({
      where: { email },
    });

    if (existing) {
      if (userId && !existing.userId) {
        await this.prisma.vaultClosetSaleInterest.update({
          where: { email },
          data: { userId },
        });
      }
      return {
        success: true,
        alreadySubscribed: true,
        message: 'You are already on the notify list for this sale.',
      };
    }

    await this.prisma.vaultClosetSaleInterest.create({
      data: { email, userId },
    });

    return {
      success: true,
      alreadySubscribed: false,
      message: 'Thanks. We will email you when the Vault Closet sale is live.',
    };
  }
}
