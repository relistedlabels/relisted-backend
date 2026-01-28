import { IsObject } from "class-validator";

export class CreateTagDto {
     @IsObject()
    name:string 
}
