import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { DispatchWindowsDto } from 'src/module/order/dto/create-order.dto';

export class RequestAvailabilityDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWindowsDto)
  dispatchWindows?: DispatchWindowsDto;
}
