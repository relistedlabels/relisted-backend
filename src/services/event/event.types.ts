export class Verification_Mail {
  constructor(
    public readonly email: string,
    public readonly code: string,
    public readonly name: string,
    public readonly year: number,
  ) {}
}


import { IsEmail, IsNumber, IsString } from 'class-validator';

export class VerificationDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  year: number;
}


 
export class Order_Verification {
  constructor( public readonly email: string,
    public readonly renterName : string,
     public readonly curatorName: string,
    public readonly orderId: string,
    
    public readonly totalAmount: number,
    public readonly platformName: string,
    public readonly approvalLink: string,
    public readonly days:string,
    public readonly productName: string,
    public readonly price: number,

   


    


  ){}
}