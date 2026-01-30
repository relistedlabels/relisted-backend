import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreateEmergencyDto {
  @ApiProperty()
  @IsString()
  name: string;
  @ApiProperty()
  @IsString()
  relationship: string;
  @ApiProperty()
  @IsString()
  phoneNumber: string;
  @ApiProperty()
  @IsString()
  city: string;
  @ApiProperty()
  @IsString()
  state: string;
}

export class CreateBusinessInfoDto {
  @ApiProperty()
  @IsString()
  businessName: string;
  @ApiProperty()
  @IsString()
  businessEmail: string;
  @ApiProperty()
  @IsString()
  businessRegistrationNumber: string;
  @ApiProperty()
  @IsString()
  businessAddress: string;
  @ApiProperty()
  @IsString()
  businessCity: string;
  @ApiProperty()
  @IsString()
  businessState: string;
}

export class CreateBankInfoDto {
  @ApiProperty()
  @IsString()
  bankName: string;
  @ApiProperty()
  @IsString()
  accountNumber: string;
  @ApiProperty()
  @IsString()
  nameOfAccount: string;
}

export class CreateAddressInfoDto {
  @ApiProperty()
  @IsString()
  street: string;
  @ApiProperty()
  @IsString()
  city: string;
  @ApiProperty()
  @IsString()
  state: string;
  @ApiProperty()
  @IsString()
  country: string;
}

export class CreateProfileDto {
  @ApiProperty()
  @IsString()
  phoneNumber: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bvn?: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => CreateBusinessInfoDto)
  @IsOptional()
  businessInfo?: CreateBusinessInfoDto;

  @ApiProperty()
  @ValidateNested()
  @Type(() => CreateAddressInfoDto)
  @IsOptional()
  address?: CreateAddressInfoDto;

  @ApiProperty()
  @ValidateNested()
  @Type(() => CreateEmergencyDto)
  @IsOptional()
  emergencyContact?: CreateEmergencyDto;

  /** Frontend sends plural; whitelist so validation accepts it */
  @ApiProperty()
  @ValidateNested()
  @Type(() => CreateEmergencyDto)
  @IsOptional()
  emergencyContacts?: CreateEmergencyDto;

  @ApiProperty()
  @ValidateNested()
  @Type(() => CreateBankInfoDto)
  @IsOptional()
  bankAccounts?: CreateBankInfoDto;

  @ApiProperty()
  @IsString()
  @IsOptional()
  avatarUploadId?: string;
}


export class upgradeProfile {
  @ApiProperty()
  @ValidateNested()
  @Type(() => CreateBusinessInfoDto)
  businessInfo: CreateBusinessInfoDto;
}
