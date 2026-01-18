import { Injectable } from '@nestjs/common';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { UpdateWaitlistDto } from './dto/update-waitlist.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Injectable()
export class WaitlistService {
  constructor(private readonly prisma:PrismaService){}
async  create(createWaitlistDto: CreateWaitlistDto) {
    return  await this.prisma.waitList.create({
      data:{
        email:createWaitlistDto.email
      }
    })
  }

async  findAll() {
    return await this.prisma.waitList.findMany({});
  }


}
