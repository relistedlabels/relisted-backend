import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ManualCompleteShipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  trackingId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trackingUrl?: string;
}
