import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Role_key } from '../decorator/roles.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(Role_key, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.role) {
      throw new ForbiddenException('User role not found');
    }

    // Role hierarchy: higher number = more privileges
    const roleHierarchy: Record<Role, number> = {
      RENTER: 1,
      LISTER: 2,
      ADMIN: 3,
    };

    // Check if user has one of the required roles or a higher privilege
    const userRoleLevel = roleHierarchy[user.role] || 0;
    const hasAccess = requiredRoles.some(
      (requiredRole) => userRoleLevel >= roleHierarchy[requiredRole],
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        `Access denied. Required role: ${requiredRoles.join(' or ')}`,
      );
    }

    return true;
  }
}
