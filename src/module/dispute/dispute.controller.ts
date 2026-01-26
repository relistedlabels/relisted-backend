import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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



  @Auth()
  @Get()
  findAllDispute (@AuthUser() user:userEntity){
    return this.disputeService.findAll(user)

  }

  @Auth()
  @Get(":id")
  findDispute (@Param("id") id:string,@AuthUser() user:userEntity){
    return this.disputeService.findOne(id,user)

  }
  

}
