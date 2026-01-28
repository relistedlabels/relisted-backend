import { ApiProperty } from "@nestjs/swagger";
import { IsObject } from "class-validator";

export class CreateCategoryDto {
    @ApiProperty()
    @IsObject()
    name:string 
}
