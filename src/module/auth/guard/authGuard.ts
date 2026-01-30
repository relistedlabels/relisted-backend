// import {
//   CanActivate,
//   ExecutionContext,
//   Injectable,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { JwtService } from '@nestjs/jwt';
// import { Request } from 'express';
// import { Observable } from 'rxjs';
// import { PrismaService } from 'src/services/prisma/prisma.service';

// @Injectable()
// export class JwtAuthGuard implements CanActivate {
//   constructor(
//     private jwtService: JwtService,
//     private prismaService: PrismaService,
//   ) {}
//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();
//     const token = this.extractHeaderToken(request);

//     if (!token){
//          throw new UnauthorizedException('Invalid credentials');
      
//     }
//     try {
//       //  verify the voken
//       const payload = await this.jwtService.verifyAsync(token, {
//         secret: process.env.JWT_SECRET,
//       });
//       // FIND USER

//       const user = await this.prismaService.user.findUnique({
//         where: {
//           id: payload.sub,
//         },
        
//         select: {
//           id: true,
//           name: true,
//           email: true,
//           role: true,
//           isVerified: true,
//           provider: true,
//           createdAt: true,
//            profile: true,
//         },
        
//       });

//       if (!user) {
//         throw new UnauthorizedException('user not found');
//       }

//       request.user = user;
    
//     } catch (error) {
//       throw new UnauthorizedException();
//     }

//     return true;
//   }

//   private extractHeaderToken(request: Request): string | undefined {
//     const authHeader = request.headers.authorization;
//     if (authHeader && authHeader.startsWith('Bearer')) {
//       return authHeader.split(' ')[1];
//     }
//   }
// }



import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorator/roles.decorator'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prismaService: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ✅ Skip guard for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) throw new UnauthorizedException('No token provided');

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
        },
      });

      if (!user) throw new UnauthorizedException('User not found');

      (request as any).user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.split(' ')[1];
  }
}
