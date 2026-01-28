import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CreateProfileDto, upgradeProfile } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { userEntity } from '../auth/auth.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

async create(dto: CreateProfileDto, user: userEntity) {
  const profile = await this.prisma.profile.create({
    data: {
      phoneNumber: dto.phoneNumber,

      // ...(dto.bvn && { bvn: dto.bvn }),

      // emergencyContacts: {
      //   create: dto.emergencyContacts,
      // },

    

   

      ...(dto.address && {
        address: {
          create: [dto.address],
        },
      }),

      user: {
        connect: { id: user.id },
      },

      // ...(dto.avatarUploadId && {
      //   avatarUpload: {
      //     connect: { id: dto.avatarUploadId },
      //   },
      // }),

      // ...(dto.ninUploadId && {
      //   ninUpload: {
      //     connect: { id: dto.ninUploadId },
      //   },
      // }),
    },

    include: {
      // emergencyContacts: true,
      businessInfo: true,
      // bankAccounts: true,
      address: true,
      // avatarUpload: true,
      // ninUpload: true,
    },
  });

  return {
    message: 'User profile created',
    profile,
  };
}


  async findAll() {
    const profiles = await this.prisma.profile.findMany({
      include: {
        user: true,
        emergencyContacts: true,
        businessInfo: true,
        address: true,
        // bankAccounts: true,
      },
    });

    return {
      message: 'Profiles retrieved successfully',
      data: profiles,
    };
  }

  async findOne(user:userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: {
        emergencyContacts: true,
        businessInfo: true,
        address: true,
        // bankAccounts: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return {
      message: 'Profile retrieved successfully',
      data: profile,
    };
  }

  
  
  async update(id: string, dto: UpdateProfileDto, user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { id },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    

    const updatedProfile = await this.prisma.profile.update({
      where: { userId: user.id },
      data: {
        phoneNumber: dto.phoneNumber,
           ...(dto.avatarUploadId && {
        avatarUpload: {
          connect: { id: dto.avatarUploadId },
        },
      }),
        // bvn: dto.bvn,
      },
    });

    return {
      message: 'Profile updated successfully',
      data: updatedProfile,
    };
  }


async upgradeProfileToLister(profileId: string, user: userEntity,dto:upgradeProfile) {
  const profile = await this.prisma.profile.findUnique({
    where: { id: profileId },
    include: { user: true, businessInfo: true }, 
  });

  if (!profile) {
    throw new NotFoundException('Profile not found');
  }

  if (profile.isApproved) {
    throw new BadRequestException('Profile already verified');
  }

  // Check required fields for LISTER upgrade
  if (!profile.businessInfo?.length) {
    throw new BadRequestException(
      'Profile is incomplete. business information is required to become a LISTER',
    );
  }

  // Approve profile and upgrade role
  const verifiedProfile = await this.prisma.profile.update({
    where: { id: profile.id },
    data: {
      isApproved: true,
      ...(dto.businessInfo && {
  businessInfo: {
    upsert: {
      where: { profileId: profileId },
      create: dto.businessInfo,
      update: dto.businessInfo,
    },
  },
}),

      user: {
        update: { role: 'LISTER' }, 
      },
    },
    include: { user: true },
  });

  return {
    message: 'User profile verified and role upgraded to LISTER successfully',
    data: verifiedProfile,
  };
}





  async remove(id: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    await this.prisma.profile.delete({
      where: { id },
    });

    return {
      message: 'Profile deleted successfully',
    };
  }
}
