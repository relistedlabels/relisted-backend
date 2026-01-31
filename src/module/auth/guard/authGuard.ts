import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prismaService: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractHeaderToken(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.prismaService.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isVerified: true,
          provider: true,
          createdAt: true,
          profile: true,
          tokenVersion: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('user not found');
      }

      const tokenVersion = (payload as { v?: number }).v ?? 0;
      if (user.tokenVersion !== tokenVersion) {
        throw new UnauthorizedException();
      }

      request.user = user;
    
    } catch (error) {
      throw new UnauthorizedException();
    }

    return true;
  }

  private extractHeaderToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }
  }
}
