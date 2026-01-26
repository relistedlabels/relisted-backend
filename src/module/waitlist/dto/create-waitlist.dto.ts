import { IsString } from "class-validator";

export class CreateWaitlistDto {
    @IsString()
    email:string


}
