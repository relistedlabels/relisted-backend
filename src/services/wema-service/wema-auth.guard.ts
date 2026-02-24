import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

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
    const expectedToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJodHRwOi8vc2NoZW1hcy54bWxzb2FwLm9yZy93cy8yMDA1LzA1L2lkZW50aXR5L2NsYWltcy9uYW1lIjoiUmVsaXN0ZWQtbGFiZWxzIiwibmJmIjoxNzY4OTk4MTIxLCJleHAiOjE4MDA1MzQxMjEsImlzcyI6ImFwcHMud2VtYWJhbmsuY29tIiwiYXVkIjoiYXBwcy53ZW1hYmFuay5jb20ifQ.MpYaqOEyVLkQlKJFUf6CoU6iKNpXJNC4LxBtq2MY_NQ";

    // Validate the statically provided JWT
    if (token !== expectedToken) {
      throw new UnauthorizedException('Invalid Token');
    }

    return true;
  }
}
