import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  rentalId?: string;

  @ApiProperty({ required: false, description: 'Alternative to rentalId - the order public ID (ORD-...)' })
  @IsOptional()
  orderId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty()
  @IsOptional()
  comment?: string;
}
