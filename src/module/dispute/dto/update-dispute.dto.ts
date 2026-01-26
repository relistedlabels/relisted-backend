import { PartialType } from '@nestjs/swagger';
import { CreateDisputeDto } from './create-dispute.dto';

export class UpdateDisputeDto extends PartialType(CreateDisputeDto) {}
