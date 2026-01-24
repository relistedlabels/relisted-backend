import { Injectable } from '@nestjs/common';
import { CreateFundWalletDto } from './dto/create-wema-service.dto';
import { UpdateWemaServiceDto } from './dto/update-wema-service.dto';
import { userEntity } from 'src/module/auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { addMinutes } from 'date-fns';

@Injectable()
export class WemaServiceService {
  constructor(private readonly prisma:PrismaService){}
async fundWallet(user:userEntity, amount: number) {
const userExist =await this.prisma.user.findUnique({
  where:{id:user.sub},
  include:{
    profile:true
  }
})
  const vaNumber = `759${Math.floor(100000000 + Math.random() * 900000000)}`;
 
  const virtualAccount = await this.prisma.virtualAccount.create({
    data: {
      userId: user.sub,
      prefix:"759",
      vaNumber,
      amount,
      status: 'PENDING',
      expiresAt: addMinutes(new Date(), 30),
      orderId:"123"
      
    },
  });

  return {
    message: 'Virtual account generated',
    vaNumber: virtualAccount.vaNumber,
    amount: virtualAccount.amount,
    expiresAt: virtualAccount.expiresAt,
  };
}
  findAll() {
    return `This action returns all wemaService`;
  }

  findOne(id: number) {
    return `This action returns a #${id} wemaService`;
  }

  update(id: number, updateWemaServiceDto: UpdateWemaServiceDto) {
    return `This action updates a #${id} wemaService`;
  }

  remove(id: number) {
    return `This action removes a #${id} wemaService`;
  }
}
