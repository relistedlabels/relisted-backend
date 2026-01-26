import { Injectable } from '@nestjs/common';
import { CreateFundWalletDto } from './dto/create-wema-service.dto';
import { UpdateWemaServiceDto } from './dto/update-wema-service.dto';
import { userEntity } from 'src/module/auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { addMinutes } from 'date-fns';
import { generateTransactionRef } from 'src/utils/ref.util';
import { connectId } from 'prisma/prisma.utils';

@Injectable()
export class WemaServiceService {
  constructor(private readonly prisma:PrismaService){}
async createAccount(user:userEntity,amount:number) {
const userExist =await this.prisma.user.findUnique({
  where:{id:user.sub},
  include:{
    profile:true
  }
})



  const vaNumber = `759${Math.floor(100000000 + Math.random() * 900000000)}`;
//  create virtual account
  const virtualAccount = await this.prisma.virtualAccount.create({
    data: {
      userId: user.sub,
      prefix:"759",
      vaNumber,
      status: 'PENDING',
      expiresAt: addMinutes(new Date(), 30),
     
      bvn:userExist?.profile?.bvn
      
    },
  });

// create transaction 
const transaction =await this.prisma.transaction.create({
  data:{
    amount,
    referenceId:await generateTransactionRef(),
    user:connectId(user.sub)
  }
})


  return {
    message: 'Virtual account generated',
    vaNumber: virtualAccount.vaNumber,
    amount: virtualAccount.amount,
    expiresAt: virtualAccount.expiresAt,
    transactionReference:transaction.referenceId
    
  };
}

}
