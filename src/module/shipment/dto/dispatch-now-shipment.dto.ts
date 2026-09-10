import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DispatchNowShipmentDto {
  /** Required when converting Relisted dispatch to carrier booking, or changing tier on retry. */
  @IsOptional()
  @IsString()
  pricingTier?: string;

  /** When true (default), pull the dispatch window forward if it is still in the future and book now. When false, keep the window and leave PENDING for the dispatch scheduler. */
  @IsOptional()
  @IsBoolean()
  updateWindow?: boolean;
}
