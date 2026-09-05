import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SwitchToManualShipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminReconcileNote?: string;
}
