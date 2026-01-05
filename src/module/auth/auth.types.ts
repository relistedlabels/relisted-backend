
import{IsEmail, IsString} from "class-validator"
// import { Role } from "@prisma/client"

export const Auth_Otp_Token_Subject ={
    Verify_Email:"verify email",
    RESET_PASSWORD:"RESET Password"
}

export class registerDto {
    @IsString()
    name:string
    
    @IsEmail()
    email:string

    @IsString()
    phoneNumber:string

    @IsString()
    gender:string

    @IsString()
    password:string
    // // email:
    // role:Role
}



export class loginDto{
    @IsEmail()
    email:string
    @IsString()
    password:string
}


export class verifyEmailDto{
    @IsString()
    code:string
}

export class resetPasswordDto{
     @IsString()
    code:string
     @IsString()
    password:string
     @IsString()
    email:string
}

export class forgotPasswordDto{
    @IsEmail()
    email:string
}


export class userEntity{
    sub:string
    // role:Role
    email:string
    isVerified:boolean
    name:string
}


export class ResendVerificationEmail {
  @IsEmail()
  email: string;
}