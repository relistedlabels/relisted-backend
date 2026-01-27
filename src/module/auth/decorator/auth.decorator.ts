import { applyDecorators, createParamDecorator, ExecutionContext, UseGuards } from "@nestjs/common";
import { Role, User } from "@prisma/client";
import { JwtAuthGuard } from "../guard/authGuard";
import { RoleGuard } from "../guard/roleGuard";
import { Roles } from "./roles.decorator";


export const Auth = (roles?: Role[]) => {

  if (!roles || roles.length === 0) {
    return applyDecorators(UseGuards(JwtAuthGuard));
  }
  

  return applyDecorators(
    Roles(...roles),       
    UseGuards(JwtAuthGuard, RoleGuard) 
  );
};




    


export const AuthUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: User }>();
    const user = request.user;
      console.log('AuthUser:', request.user);

    return data ? user?.[data] : user;
  },
);

