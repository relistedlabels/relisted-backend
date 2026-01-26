import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateFundWalletDto } from './dto/create-wema-service.dto';
import { UpdateWemaServiceDto } from './dto/update-wema-service.dto';
import { WemaServiceService } from './wema-service.service';

@Controller('wema-service')
export class WemaServiceController {
  constructor(private readonly wemaServiceService: WemaServiceService) {}

  // @Post()
  // create(@Body() createWemaServiceDto: CreateFundWalletDto) {
  //   return this.wemaServiceService.fund(CreateFundWalletDto);
  // }


  
}
