import { Injectable } from '@nestjs/common';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { UpdateDisputeDto } from './dto/update-dispute.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { connectId, createAttachments } from 'prisma/prisma.utils';
import { userEntity } from '../auth/auth.types';
import { DisputeStatus } from '@prisma/client';

@Injectable()
export class DisputeService {
  constructor(private readonly prisma:PrismaService){}
async  create(dto: CreateDisputeDto,user:userEntity) {
    // find if the order exist  
    const orderExist  =await this.prisma.order.findUnique({
      where:{
        id:dto.orderId
      },
      include:{
        rental:{
          include:{
            product:true
          }
        },
       
        user:true
      }
    })

    if(!orderExist) bad ("order not found")

       if (orderExist.userId !== user.id) {
      bad('You are not allowed to dispute this order');
    }

      const existingDispute = await this.prisma.dispute.findFirst({
      where: {
        orderId: orderExist.id,
        userId: user.id,
      },
    });

    if (existingDispute) {
      bad('A dispute already exists for this order');
    }

      // create dispute 
      const newDispute =await this.prisma.dispute.create({
        data:{
          disputeId:await this.generateDisputeId(),
          issueCategory:dto.issueCategory,
          description:dto.description,
          order:connectId(orderExist.id),
          user:connectId(user.id),
          chatRooms:{
            create:{}
          },
          attachment:dto.attachments ?createAttachments(dto.attachments):undefined
        }
      })


    return {
      message:" dispute created successfully",
      data:newDispute
    }
  }


  async findAll(user:userEntity) {
     return await this.prisma.dispute.findMany({
    where:{
    userId:user.id
  }

 })
  }

async  findOne(id: string,user:userEntity) {
 return await this.prisma.dispute.findFirst({
  where:{
    id,
    userId:user.id
  }

 })
  
  }

  async withdrawDispute(id:string) {
    return await this.prisma.dispute.update({
      where:{
        id
      },
      data:{
        status:DisputeStatus.WITHDRAW
      }
    })
  }



   async generateDisputeId() {
    return `DQ-${Date.now()}`;
  }
}
