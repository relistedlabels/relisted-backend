import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsArray,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUUID,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ItemCondition } from '@prisma/client';
import { DispatchWindowDto } from 'src/module/order/dto/create-order.dto';

export class SelectedReturnRateDto {
  @ApiProperty({ example: 'Standard' })
  @IsString()
  pickupPartner!: string;

  @ApiProperty({ example: 3500 })
  @IsNumber()
  shipmentCharge!: number;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  pickupCharge!: number;

  @ApiProperty({ example: 250 })
  @IsNumber()
  vatCharge!: number;

  @ApiProperty({ example: 'Budget' })
  @IsString()
  pricingTier!: string;

  @ApiProperty({ example: 4750 })
  @IsNumber()
  totalCharge!: number;
}

export class CreateReturnRequestDto {
  @ApiProperty({ enum: ItemCondition, example: ItemCondition.GOOD })
  @IsEnum(ItemCondition)
  @IsNotEmpty()
  itemCondition: ItemCondition;

  @ApiProperty({ required: false, example: 'No damages found.' })
  @IsString()
  @IsOptional()
  damageNotes?: string;

  @ApiProperty({ type: [String], example: ['uuid'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @ApiProperty({ required: false, type: DispatchWindowDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowDto)
  pickupWindow?: DispatchWindowDto;

  @ApiProperty({ required: false, type: SelectedReturnRateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SelectedReturnRateDto)
  selectedRate?: SelectedReturnRateDto;

  @ApiProperty({
    required: false,
    description:
      'Shipment ID to link return request to (for multi-lister orders)',
  })
  @IsUUID()
  @IsOptional()
  shipmentId?: string;
}
