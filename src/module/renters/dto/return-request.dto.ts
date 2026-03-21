import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsArray, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ItemCondition } from '@prisma/client';

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
  imageUrls: string[];
}
