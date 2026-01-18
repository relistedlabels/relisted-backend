import { Body, Controller, Post } from '@nestjs/common';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { userEntity } from '../auth/auth.types';
@Controller('dispute')
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  @Auth()
  @Post()
  create(@Body() createDisputeDto: CreateDisputeDto,@AuthUser() user:userEntity) {
    return this.disputeService.create(createDisputeDto,user);
  }

}
