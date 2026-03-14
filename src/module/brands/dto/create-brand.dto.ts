import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsString } from "class-validator";

export class CreateBrandDto {
    @ApiProperty()

    @IsString()
    name:string 
}
