import { IsString } from "class-validator";


export class CreateFundWalletDto {
    @IsString()
    amount:number
}
