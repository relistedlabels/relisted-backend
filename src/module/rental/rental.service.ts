import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class RentalService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: userEntity) {
    return this.prisma.rental.findMany({
      where: {
        userId: user.id,
      },
      include: {
        product: {
          include: {
            attachments: {
              include: {
                uploads: true,
              },
            },
          },
        },
        review: true,
        curator: {
          select: {
            name: true,
            email: true,
            profile: {
              include: {
                avatarUpload: true,
                businessInfo: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string, user: userEntity) {
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            attachments: {
              include: {
                uploads: true,
              },
            },
          },
        },
        review: true,
        curator: {
          select: {
            name: true,
            email: true,
            profile: {
              include: {
                avatarUpload: true,
                businessInfo: true,
              },
            },
          },
        },
        order: true,
      },
    });

    if (!rental) {
      throw new NotFoundException(`Rental with ID ${id} not found`);
    }

    // Allow both rentee and curator to view the rental
    if (rental.userId !== user.id && rental.curatorId !== user.id) {
      throw new NotFoundException(`Rental with ID ${id} not found`);
    }

    return rental;
  }
}
