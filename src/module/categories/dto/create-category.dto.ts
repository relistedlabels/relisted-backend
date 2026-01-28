import { IsObject } from "class-validator";

export class CreateCategoryDto {
    @IsObject()
    name:string 
}
