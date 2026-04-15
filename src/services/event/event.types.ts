export class Verification_Mail {
  constructor(
    public readonly email: string,
    public readonly code: string,
    public readonly name: string,
    public readonly year: number,
    /** Verification link (one-time, expires). When set, email uses link instead of OTP. */
    public readonly verificationLink?: string,
    /** Expiry in minutes for user-facing message */
    public readonly expiryMinutes?: number,
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

export class Order_Resale_Placed {
  constructor(
    public readonly orderId: string,
    public readonly listerId: string,
    public readonly listerName: string,
    public readonly buyerName: string,
    public readonly items: any[],
  ) {}
}

export class Order_Escrow_Released {
  constructor(
    public readonly orderId: string,
    public readonly buyerId: string,
    public readonly buyerName: string,
    public readonly buyerEmail: string,
    public readonly listerId: string,
    public readonly amount: number,
  ) {}
}

export class Password_Reset_Mail {
  constructor(
    public readonly email: string,
    public readonly code: string,
    public readonly name: string,
    public readonly year: number,
    /** Expiry in minutes for user-facing message */
    public readonly expiryMinutes?: number,
  ) {}
}