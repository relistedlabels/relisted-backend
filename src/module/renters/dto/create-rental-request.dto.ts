import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { DispatchWindowsDto } from 'src/module/order/dto/create-order.dto';

export class CreateRentalRequestDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  listerId!: string;

  @IsOptional()
  @IsString()
  rentalStartDate?: string | null;

  @IsOptional()
  @IsString()
  rentalEndDate?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  rentalDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedRentalPrice!: number;

  @IsOptional()
  @IsString()
  deliveryAddressId?: string;

  @IsOptional()
  @IsBoolean()
  autoPay?: boolean;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsUUID()
  cartItemId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowsDto)
  dispatchWindows?: DispatchWindowsDto;
}
