import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
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
  const emergencyContactData =
    dto.emergencyContact ?? dto.emergencyContacts;

  const profile = await this.prisma.profile.create({
    data: {
      phoneNumber: dto.phoneNumber,
      ...(dto.bvn != null && dto.bvn !== ''
        ? { bvn: dto.bvn }
        : {}),
        
      ...(dto.nin != null && dto.nin !== ''
        ? { nin: dto.nin }
        : {}),

      ...(dto.businessInfo && {
        businessInfo: {
          create: dto.businessInfo,
        },
      }),

      ...(dto.address && {
        address: {
          create: dto.address,
        },
      }),

      ...(emergencyContactData && {
        emergencyContact: {
          create: emergencyContactData,
        },
      }),

      ...(dto.avatarUploadId && dto.avatarUploadId !== ''
        ? { avatarUpload: { connect: { id: dto.avatarUploadId } } }
        : {}),

      user: {
        connect: { id: user.id },
      },
    },

    include: {
      businessInfo: true,
      address: true,
      emergencyContact: true,
      avatarUpload: true,
    },
  });

  // Handle bank account creation
  if (dto.bankAccounts) {
    await (this.prisma as any).bankAccount.create({
      data: {
        userId: user.id,
        bankName: dto.bankAccounts.bankName,
        bankCode: dto.bankAccounts.bankCode,
        accountNumber: dto.bankAccounts.accountNumber,
        accountName: dto.bankAccounts.nameOfAccount,
        isDefault: true,
      },
    });
  }

  return {
    message: 'User profile created',
    profile,
  };
}



  async findAll() {
    const profiles = await this.prisma.profile.findMany({
      include: {
        user: true,
        emergencyContact: true,
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
        emergencyContact: true,
        businessInfo: true,
        address: true,
        user:true
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

  async findOneById(id: string) {
    const profile = await this.prisma.profile.findFirst({
      where: {
        OR: [
          { id },
          { userId: id }
        ]
      },
      include: {
        emergencyContact: true,
        businessInfo: true,
        address: true,
        user: true,
        avatarUpload: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const responseData = {
      ...profile,
      avatarUrl: profile.avatarUpload?.url || null,
    };

    return {
      message: 'Profile retrieved successfully',
      data: responseData,
    };
  }

  
  
  async update(id: string, dto: UpdateProfileDto, user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: id },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }


    const updatedProfile = await this.prisma.profile.update({
      where: { userId: id},
      data: {
        phoneNumber: dto.phoneNumber,
           ...(dto.avatarUploadId && {
        avatarUpload: {
          connect: { id: dto.avatarUploadId },
        },
      }),
        // bvn: dto.bvn,
        ...(dto.bvn !== undefined ? { bvn: dto.bvn } : {}),
        ...(dto.nin !== undefined ? { nin: dto.nin } : {}),
      },
    });

    // Handle bank account update/upsert
    if (dto.bankAccounts) {
      const existingBank = await (this.prisma as any).bankAccount.findFirst({
        where: { userId: id, accountNumber: dto.bankAccounts.accountNumber }
      });

      if (existingBank) {
        await (this.prisma as any).bankAccount.update({
          where: { id: existingBank.id },
          data: {
            bankName: dto.bankAccounts.bankName,
            bankCode: dto.bankAccounts.bankCode,
            accountName: dto.bankAccounts.nameOfAccount,
          }
        });
      } else {
        await (this.prisma as any).bankAccount.create({
          data: {
            userId: id,
            bankName: dto.bankAccounts.bankName,
            bankCode: dto.bankAccounts.bankCode,
            accountNumber: dto.bankAccounts.accountNumber,
            accountName: dto.bankAccounts.nameOfAccount,
            isDefault: true,
          }
        });
      }
    }

    return {
      message: 'Profile updated successfully',
      data: updatedProfile,
    };
  }


async upgradeProfileToLister(userId: string, user: userEntity, dto: upgradeProfile) {
  // Find user's profile or create one if it doesn't exist
  let profile = await this.prisma.profile.findUnique({
    where: { userId },
    include: { user: true, businessInfo: true },
  });

  // Create profile if it doesn't exist
  if (!profile) {
    profile = await this.prisma.profile.create({
      data: {
        user: { connect: { id: userId } },
        phoneNumber: '',
      },
      include: { user: true, businessInfo: true },
    });
  }

  if (profile.isApproved && profile.user.role === 'LISTER') {
    throw new BadRequestException('Profile already verified');
  }

  // Approve profile and upgrade role
  const verifiedProfile = await this.prisma.profile.update({
    where: { id: profile.id },
    data: {
      isApproved: true,
      ...(dto.businessInfo && {
        businessInfo: {
          upsert: {
            where: { profileId: profile.id },
            create: dto.businessInfo,
            update: dto.businessInfo,
          },
        },
      }),
      user: {
        update: { role: 'LISTER' },
      },
    },
    include: { user: true, businessInfo: true },
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
