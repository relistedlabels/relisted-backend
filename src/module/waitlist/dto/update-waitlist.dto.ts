import { PartialType } from '@nestjs/swagger';
import { CreateWaitlistDto } from './create-waitlist.dto';

export class UpdateWaitlistDto extends PartialType(CreateWaitlistDto) {}
