import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class WemaAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization Header');
    }

    const tokenParts = authHeader.split(' ');
    if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
      throw new UnauthorizedException('Invalid Authorization Format');
    }

    const token = tokenParts[1];
    const expectedToken = process.env.WEMA_BEARER_TOKEN;
    if (!expectedToken) {
      throw new UnauthorizedException('Wema auth not configured');
    }

    const tokenBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expectedToken);
    if (
      tokenBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(tokenBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid Token');
    }

    return true;
  }
}
