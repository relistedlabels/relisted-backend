import { Injectable } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { userEntity } from '../auth/auth.types';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma:PrismaService){}
  async create(dto: CreateProfileDto,user:userEntity) {
    const profile = await this.prisma.profile.create({
    data:{
      phoneNumber: dto.phoneNumber,
      bvn: dto.bvn,
      emergencyContacts:{
       create:dto.emergencyContacts
      },
      businessInfo:{
        create:dto.businessInfo
      },
      address:{
        create:dto.address
      },
      bankAccounts:{
      create:dto.bankAccounts
      },
      user:{
        connect:{
          id:user.sub
        }
      },
   avatarUpload:{
    connect:{
      id:dto.avatarUploadId
    }
   },
   ninUpload:{
    connect:{
      id:dto.ninUploadId
    }
   }
    
      
    }
    })
    
    return {
      message:"user profile created",
      profile:profile
    }
  }

  findAll() {
    return `This action returns all profile`;
  }

  findOne(id: number) {
    return `This action returns a #${id} profile`;
  }

  update(id: number, updateProfileDto: UpdateProfileDto) {
    return `This action updates a #${id} profile`;
  }

  remove(id: number) {
    return `This action removes a #${id} profile`;
  }
}
