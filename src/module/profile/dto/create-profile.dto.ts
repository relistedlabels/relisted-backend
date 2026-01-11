export class CreateProfileDto {
  phoneNumber: string;
  bvn: string;
}

export class CreateEmergencyDto {
  name: string;
  relationship: string;
  phoneNumber: string;
  city: string;
  state: string;
}

export class CreateBusinessInfo {
  businessName: string;
  businessEmail: string;
  businessRegistrationNumber: string;
  businessAddress: string;
  businessCity: string;
  businessState: string;
}

export class CreateBankInfo {
  bankName: string;
  accountNumber: string;
  nameOfAccount: string;
}
