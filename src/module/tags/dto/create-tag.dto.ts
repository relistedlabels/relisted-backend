import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsString } from "class-validator";

export class CreateTagDto {
    @ApiProperty()
     @IsString()
    name:string 
}
