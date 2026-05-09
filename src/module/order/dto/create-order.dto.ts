import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  Min,
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

/** Per shipment bucket (same index as GET /order/summary `shipmentBuckets`). */
export class ShipmentBucketPricingTierDto {
  @IsInt()
  @Min(0)
  bucketIndex!: number;

  @IsString()
  pricingTier!: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  pricingTier?: string;

  /** When set for rental checkout, return-leg carrier tier (Chowdeck, Glovo, or Relisted dispatch). */
  @IsOptional()
  @IsString()
  returnPricingTier?: string;

  /** Outbound delivery tier per bucket when multiple listers or schedules (overrides single `pricingTier`). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentBucketPricingTierDto)
  outboundPricingByBucket?: ShipmentBucketPricingTierDto[];

  /** Return-leg tier per rental bucket index (overrides single `returnPricingTier`). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentBucketPricingTierDto)
  returnPricingByBucket?: ShipmentBucketPricingTierDto[];

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
