import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString } from "class-validator";

export class CreateCategoryDto {
    @ApiProperty()
    @IsString()
    name:string 

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    imageUrl?: string
}
