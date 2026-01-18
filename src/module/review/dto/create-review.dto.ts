 import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
   

export class CreateReviewDto {
  @IsUUID()
  rentalId: string;  
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
  @IsOptional()
  comment?: string;
}


