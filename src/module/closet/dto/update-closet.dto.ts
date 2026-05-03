import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateClosetDto } from './create-closet.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateClosetDto extends PartialType(CreateClosetDto) {
  @ApiPropertyOptional({
    description: 'Soft-disable closet (public/marketing hides it)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
