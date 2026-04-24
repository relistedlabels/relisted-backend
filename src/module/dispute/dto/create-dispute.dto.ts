import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateDisputeDto {
  @ApiProperty()
  @IsString()
  orderId: string;
  @ApiProperty()
  @IsString()
  issueCategory: string;
  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  preferredResolution?: string;

  @ApiProperty()
  @IsArray()
  attachments: string[];
}
