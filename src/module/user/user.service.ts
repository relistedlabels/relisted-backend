import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  create(createUserDto: CreateUserDto) {
    return 'This action adds a new user';
  }

  // Get all users with pagination (Admin only)
  async getAllUsers(page: number = 1, limit: number = 10) {
    try {
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
            isSuspended: true,
            role: true,
            _count: {
              select: {
                rentalsRented: true, // Total rentals as renter
              },
            },
          },
        }),
        this.prisma.user.count(),
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNext = page < totalPages;
      const hasPrevious = page > 1;

      return {
        success: true,
        message: 'Users retrieved successfully',
        data: {
          users: users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            totalRentals: user._count.rentalsRented,
            dateJoined: user.createdAt,
            isSuspended: user.isSuspended,
            role: user.role,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrevious,
          },
        },
      };
    } catch (error) {
      console.error('Get all users error:', error);
      throw new InternalServerErrorException('Failed to retrieve users');
    }
  }

  // Suspend user (Admin only)
  async suspendUser(userId: string, adminUser: userEntity) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, isSuspended: true },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      if (user.isSuspended) {
        throw new BadRequestException('User is already suspended');
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { isSuspended: true },
        select: {
          id: true,
          name: true,
          email: true,
          isSuspended: true,
        },
      });

      return {
        success: true,
        message: 'User suspended successfully',
        data: updatedUser,
      };
    } catch (error) {
      console.error('Suspend user error:', error);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to suspend user');
    }
  }

  // Unsuspend user (Admin only)
  async unsuspendUser(userId: string, adminUser: userEntity) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, isSuspended: true },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      if (!user.isSuspended) {
        throw new BadRequestException('User is not suspended');
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { isSuspended: false },
        select: {
          id: true,
          name: true,
          email: true,
          isSuspended: true,
        },
      });

      return {
        success: true,
        message: 'User unsuspended successfully',
        data: updatedUser,
      };
    } catch (error) {
      console.error('Unsuspend user error:', error);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to unsuspend user');
    }
  }

  findAll() {
    return `This action returns all user`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
