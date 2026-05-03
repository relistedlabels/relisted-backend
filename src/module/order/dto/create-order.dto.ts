import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type {
  DispatchWindowInput as DispatchWindowInputType,
  DispatchWindowsInput as DispatchWindowsInputType,
} from 'src/utils/dispatch-windows';

export class DispatchWindowDto {
  @IsISO8601()
  start!: string;

  @IsISO8601()
  end!: string;
}

export class DispatchWindowsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowDto)
  OUTBOUND?: DispatchWindowDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowDto)
  RETURN?: DispatchWindowDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowDto)
  RESALE?: DispatchWindowDto;
}

export class ReturnPickupAddressDto {
  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  landmark?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  pricingTier?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowsDto)
  dispatchWindows?: DispatchWindowsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReturnPickupAddressDto)
  returnPickupAddress?: ReturnPickupAddressDto;
}

export type DispatchWindowInput = DispatchWindowInputType;

export type DispatchWindowsInput = DispatchWindowsInputType;
