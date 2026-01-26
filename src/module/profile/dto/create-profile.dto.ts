import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';
export class CreateEmergencyDto {
  @ApiProperty()
  name: string;
  @ApiProperty()
  relationship: string;
  @ApiProperty()
  phoneNumber: string;
  @ApiProperty()
  city: string;
  @ApiProperty()
  state: string;
}

export class CreateBusinessInfoDto {
  @ApiProperty()
  businessName: string;
  @ApiProperty()
  businessEmail: string;
  @ApiProperty()
  businessRegistrationNumber: string;
  @ApiProperty()
  businessAddress: string;
  @ApiProperty()
  businessCity: string;
  @ApiProperty()
  businessState: string;
}

export class CreateBankInfoDto {
  @ApiProperty()
  bankName: string;
  @ApiProperty()
  accountNumber: string;
  @ApiProperty()
  nameOfAccount: string;
}

export class CreateAddressInfoDto {
  @ApiProperty()
  street: string;
  @ApiProperty()
  city: string;
  @ApiProperty()
  state: string;
  @ApiProperty()
  country: string;
}

export class CreateProfileDto {
  @ApiProperty()
  phoneNumber: string;
  @ApiProperty()
  bvn: string;

   @ApiProperty()
  @ValidateNested()
  @Type(() => CreateEmergencyDto)
emergencyContacts: CreateEmergencyDto;

 @ApiProperty()
  @ValidateNested()
  @Type(() => CreateBusinessInfoDto)
  businessInfo: CreateBusinessInfoDto;

   @ApiProperty()
  @ValidateNested()
  @Type(() => CreateBankInfoDto)
  bankAccounts: CreateBankInfoDto;

   @ApiProperty()
  @ValidateNested({ each: true })
  @Type(() => CreateAddressInfoDto)
    address: CreateAddressInfoDto;

  @ApiProperty()
  @IsString()
  avatarUploadId: string;

  @ApiProperty()
  @IsString()
  ninUploadId: string;
}
