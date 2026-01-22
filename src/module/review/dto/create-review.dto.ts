import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty()
  @IsUUID()
  rentalId: string;
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
  @ApiProperty()
  @IsOptional()
  comment?: string;
}
