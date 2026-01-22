export class Verification_Mail {
  constructor(
    public readonly email: string,
    public readonly code: string,
    public readonly name: string,
    public readonly year: number,
  ) {}
}

export class Order_Verification {
  constructor( public readonly email: string,
    public readonly name : string,
    public readonly orderId: string,
    // public readonly rentalPeriod: string,
    public readonly totalAmount: number,
    public readonly platformName: string,
    // public readonly approvalLink: string,
    


  ){}
}