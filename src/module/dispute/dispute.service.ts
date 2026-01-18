import { Injectable } from '@nestjs/common';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { UpdateDisputeDto } from './dto/update-dispute.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { connectId, createAttachments } from 'prisma/prisma.utils';
import { userEntity } from '../auth/auth.types';

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

       if (orderExist.userId !== user.sub) {
      bad('You are not allowed to dispute this order');
    }

      const existingDispute = await this.prisma.dispute.findFirst({
      where: {
        orderId: orderExist.id,
        userId: user.sub,
      },
    });

    if (existingDispute) {
      bad('A dispute already exists for this order');
    }

      // create dispute 
      const newDispute =await this.prisma.dispute.create({
        data:{
          issueCategory:dto.issueCategory,
          description:dto.description,
          order:connectId(orderExist.id),
          user:connectId(user.sub),
          attachment:dto.attachments ?createAttachments(dto.attachments):undefined
        }
      })


    return {
      message:" dispute created successfully",
      data:newDispute
    }
  }

  findAll() {
    return `This action returns all dispute`;
  }

  findOne(id: number) {
    return `This action returns a #${id} dispute`;
  }

  update(id: number, updateDisputeDto: UpdateDisputeDto) {
    return `This action updates a #${id} dispute`;
  }

  remove(id: number) {
    return `This action removes a #${id} dispute`;
  }
}
