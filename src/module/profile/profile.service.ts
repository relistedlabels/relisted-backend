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
    const emergencyContactData = dto.emergencyContact ?? dto.emergencyContacts;
    const include = {
      businessInfo: true,
      address: true,
      emergencyContact: true,
      avatarUpload: true,
      user: true,
    };

    const { profile, created } = await this.prisma.$transaction(async (tx) => {
      const existingProfile = await tx.profile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });

      let profileId = existingProfile?.id;
      let created = false;

      if (!profileId) {
        const newProfile = await tx.profile.create({
          data: {
            phoneNumber: dto.phoneNumber,
            ...(dto.bvn != null && dto.bvn !== '' ? { bvn: dto.bvn } : {}),
            ...(dto.nin != null && dto.nin !== '' ? { nin: dto.nin } : {}),
            ...(dto.avatarUploadId && dto.avatarUploadId !== ''
              ? { avatarUpload: { connect: { id: dto.avatarUploadId } } }
              : {}),
            user: {
              connect: { id: user.id },
            },
          },
          select: { id: true },
        });

        profileId = newProfile.id;
        created = true;
      }

      await tx.profile.update({
        where: { id: profileId },
        data: {
          phoneNumber: dto.phoneNumber,
          ...(dto.bvn != null && dto.bvn !== '' ? { bvn: dto.bvn } : {}),
          ...(dto.nin != null && dto.nin !== '' ? { nin: dto.nin } : {}),
          ...(dto.avatarUploadId && dto.avatarUploadId !== ''
            ? { avatarUpload: { connect: { id: dto.avatarUploadId } } }
            : {}),
        },
      });

      if (dto.businessInfo) {
        await tx.businessInfo.upsert({
          where: { profileId },
          create: {
            profile: { connect: { id: profileId } },
            ...dto.businessInfo,
          },
          update: dto.businessInfo,
        });
      }

      if (dto.address) {
        await tx.address.upsert({
          where: { profileId },
          create: {
            profile: { connect: { id: profileId } },
            ...dto.address,
          },
          update: dto.address,
        });
      }

      if (emergencyContactData) {
        await tx.emergencyContact.upsert({
          where: { profileId },
          create: {
            profile: { connect: { id: profileId } },
            ...emergencyContactData,
          },
          update: emergencyContactData,
        });
      }

      if (dto.bankAccounts) {
        const txAny = tx as any;
        const existingBank = await txAny.bankAccount.findFirst({
          where: {
            userId: user.id,
            accountNumber: dto.bankAccounts.accountNumber,
          },
        });

        if (existingBank) {
          await txAny.bankAccount.update({
            where: { id: existingBank.id },
            data: {
              bankName: dto.bankAccounts.bankName,
              bankCode: dto.bankAccounts.bankCode,
              accountName: dto.bankAccounts.nameOfAccount,
            },
          });
        } else {
          await txAny.bankAccount.create({
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
      }

      const profile = await tx.profile.findUnique({
        where: { id: profileId },
        include,
      });

      return { profile, created };
    });

    return {
      message: created ? 'User profile created' : 'User profile updated',
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

  async findOne(user: userEntity) {
    let profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: {
        emergencyContact: true,
        businessInfo: true,
        address: true,
        user: true,
        // bankAccounts: true,
      },
    });

    if (!profile) {
      profile = await this.prisma.profile.create({
        data: {
          user: { connect: { id: user.id } },
          phoneNumber: '',
        },
        include: {
          emergencyContact: true,
          businessInfo: true,
          address: true,
          user: true,
        },
      });
    }

    return {
      message: 'Profile retrieved successfully',
      data: profile,
    };
  }

  async findOneById(id: string) {
    const profile = await this.prisma.profile.findFirst({
      where: {
        OR: [{ id }, { userId: id }],
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
      where: { userId: id },
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
        where: { userId: id, accountNumber: dto.bankAccounts.accountNumber },
      });

      if (existingBank) {
        await (this.prisma as any).bankAccount.update({
          where: { id: existingBank.id },
          data: {
            bankName: dto.bankAccounts.bankName,
            bankCode: dto.bankAccounts.bankCode,
            accountName: dto.bankAccounts.nameOfAccount,
          },
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
          },
        });
      }
    }

    return {
      message: 'Profile updated successfully',
      data: updatedProfile,
    };
  }

  async upgradeProfileToLister(
    userId: string,
    user: userEntity,
    dto: upgradeProfile,
  ) {
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
