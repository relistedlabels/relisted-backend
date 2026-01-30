import { SetMetadata } from "@nestjs/common"
import { Role } from "@prisma/client"

export const Role_key ="roles"
export const Roles =(...roles:Role[])=>SetMetadata(Role_key,roles)

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);