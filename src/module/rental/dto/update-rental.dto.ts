import { PartialType } from '@nestjs/swagger';
import { CreateRentalDto } from './create-rental.dto';

export class UpdateRentalDto extends PartialType(CreateRentalDto) {}
