import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { Role_key } from "../decorator/roles.decorator";

@Injectable()
export class RoleGuard implements CanActivate{
    constructor(private reflector:Reflector){}
canActivate(context: ExecutionContext): boolean {
    const requiredRole =this.reflector.getAllAndOverride<Role[]>(Role_key,[
        context.getHandler(),
        context.getClass()
    ])

    if(!requiredRole){
        return true
    }

    // check for user  
    const {user} = context.switchToHttp().getRequest()
    return requiredRole.some((role)=>user.role.includes(role))
    

    
}
}