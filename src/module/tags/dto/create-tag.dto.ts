import { ApiProperty } from "@nestjs/swagger";
import { IsObject } from "class-validator";

export class CreateTagDto {
    @ApiProperty()
     @IsObject()
    name:string 
}
