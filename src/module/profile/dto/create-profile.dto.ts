import { Type } from "class-transformer";
import { IsArray, ValidateNested } from "class-validator";
export class CreateEmergencyDto {
  name: string;
  relationship: string;
  phoneNumber: string;
  city: string;
  state: string;
}

export class CreateBusinessInfoDto {
  businessName: string;
  businessEmail: string;
  businessRegistrationNumber: string;
  businessAddress: string;
  businessCity: string;
  businessState: string;
}

export class CreateBankInfoDto {
  bankName: string;
  accountNumber: string;
  nameOfAccount: string;
}

export class CreateAddressInfoDto {
  street: string;
  city: string;
  state: string;
  country: string;
}

export class CreateProfileDto {
  phoneNumber: string;
  bvn: string;
  
  @ValidateNested({ each: true })
  @Type(() => CreateEmergencyDto)
  @IsArray()
  emergencyContacts: CreateEmergencyDto[];

  @ValidateNested()
  @Type(() => CreateBusinessInfoDto)
  businessInfo: CreateBusinessInfoDto;

  @ValidateNested({ each: true })
  @Type(() => CreateBankInfoDto)
  @IsArray()
  bankAccounts: CreateBankInfoDto[];

@ValidateNested({ each: true })
  @Type(() => CreateAddressInfoDto)
  @IsArray()
  address: CreateAddressInfoDto[];
    @IsArray()
  attachments:string[]
}

