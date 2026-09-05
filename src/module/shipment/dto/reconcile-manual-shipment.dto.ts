import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReconcileManualShipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  trackingId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trackingUrl?: string;

  /** What Relisted actually paid to fulfill this leg (kobo). */
  @IsOptional()
  @IsInt()
  @Min(0)
  actualFulfillmentCostKobo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminReconcileNote?: string;
}
