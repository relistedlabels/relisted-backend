import { IsEmail, IsNumber, IsString } from "class-validator"

export class VerificationDto{
    @IsEmail()
    email:string
    
    @IsString()
    code:string

    @IsString()
    name:string
    
    @IsNumber()
    year:number
}