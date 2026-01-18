import { IsArray, IsString } from "class-validator"

export class CreateDisputeDto {
    @IsString()
    orderId:string
    @IsString()
    issueCategory:string
    @IsString()
    description:string
    @IsArray()
    attachments:string[]
}
