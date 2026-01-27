import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
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
    @IsOptional()
  businessName?:string;
  @ApiProperty()
    @IsOptional()
  businessEmail?:string;
  @ApiProperty()
    @IsOptional()
  businessRegistrationNumber?:string;
  @ApiProperty()
    @IsOptional()
  businessAddress?:string;
  @ApiProperty()
    @IsOptional()
  businessCity?:string;
  @ApiProperty()
    @IsOptional()
  businessState?:string;
}

export class CreateBankInfoDto {
  @ApiProperty()
    @IsOptional()
  bankName?:string;
  @ApiProperty()
    @IsOptional()
  accountNumber?:string;
  @ApiProperty()
  nameOfAccount?:string;
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
    @IsOptional()
  bvn?:string;

   @ApiProperty()
  @ValidateNested()
  @Type(() => CreateEmergencyDto)
    @IsOptional()
emergencyContacts: CreateEmergencyDto;

 @ApiProperty()
  @ValidateNested()
  @Type(() => CreateBusinessInfoDto)
    @IsOptional()
  businessInfo: CreateBusinessInfoDto;

   @ApiProperty()
  @ValidateNested()
  @Type(() => CreateBankInfoDto)
  @IsOptional()
  bankAccounts: CreateBankInfoDto;

   @ApiProperty()
  @ValidateNested({ each: true })
  @Type(() => CreateAddressInfoDto)
  @IsOptional()
  address?:CreateAddressInfoDto;

  @ApiProperty()
  @IsString()
  @IsOptional()
  avatarUploadId?:string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  ninUploadId?:string;
}
