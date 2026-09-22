import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { DispatchWindowsDto } from 'src/module/order/dto/create-order.dto';
import { IsValidPhone } from 'src/utils/is-valid-phone.decorator';

export class GuestAvailabilityRequestDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsUUID()
  listerId: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ required: false, description: 'WhatsApp number for notifications' })
  @IsOptional()
  @IsString()
  @IsValidPhone()
  whatsappPhone?: string;

  @ApiProperty({ description: '0 for purchase/resale, 1+ for rental' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rentalDays: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rentalStartDate?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rentalEndDate?: string | null;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedRentalPrice: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowsDto)
  dispatchWindows?: DispatchWindowsDto;
}
