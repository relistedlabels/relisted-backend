import { ApiProperty } from "@nestjs/swagger";
import { IsObject } from "class-validator";

export class CreateBrandDto {
    @ApiProperty()

    @IsObject()
    name:string 
}
