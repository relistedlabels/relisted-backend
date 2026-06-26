import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateShopSaleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  internalName: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  headline: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subheadline?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  shopTitle: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shopDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  preSaleMessage?: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsOptional()
  @IsDateString()
  earliestDeliveryAt?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  bannerEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  waitlistEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  shopAccessEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  showCountdown?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notifyEmailSubject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notifyEmailBody?: string;
}
