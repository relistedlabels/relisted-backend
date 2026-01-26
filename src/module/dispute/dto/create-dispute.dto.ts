import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

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
  @ApiProperty()
  @IsArray()
  attachments: string[];
}
