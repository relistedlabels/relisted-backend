import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Query,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

@ApiTags('Admin Users')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/users')
export class AdminUsersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Get all users' })
  async getAllUsers() {
    return this.adminService.getAllUsers();
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get user details' })
  async getUserDetails(@Param('userId') userId: string) {
    return this.adminService.getUserDetails(userId);
  }

  @Get(':userId/rentals')
  @ApiOperation({ summary: 'Get user rentals' })
  async getUserRentals(@Param('userId') userId: string) {
    return this.adminService.getUserRentals(userId);
  }

  @Get(':userId/listings')
  @ApiOperation({ summary: 'Get user listings' })
  async getUserListings(@Param('userId') userId: string) {
    return this.adminService.getUserListings(userId);
  }

  @Get(':userId/wallet')
  @ApiOperation({ summary: 'Get user wallet' })
  async getUserWallet(@Param('userId') userId: string) {
    return this.adminService.getUserWallet(userId);
  }

  @Get(':userId/transactions')
  @ApiOperation({ summary: 'Get user transactions' })
  async getUserTransactions(@Param('userId') userId: string) {
    return this.adminService.getUserTransactions(userId);
  }

  @Get(':userId/disputes')
  @ApiOperation({ summary: 'Get user disputes' })
  async getUserDisputes(@Param('userId') userId: string) {
    return this.adminService.getUserDisputes(userId);
  }

  @Get(':userId/favorites')
  @ApiOperation({ summary: 'Get user favorites' })
  async getUserFavorites(@Param('userId') userId: string) {
    return this.adminService.getUserFavorites(userId);
  }

  @Patch(':userId/verify')
  @ApiOperation({ summary: 'Verify user' })
  async verifyUser(
    @Param('userId') userId: string,
    @Body('verified') verified: boolean,
  ) {
    return this.adminService.verifyUser(userId, verified);
  }

  @Patch(':userId/suspend')
  @ApiOperation({ summary: 'Suspend/Unsuspend user' })
  async suspendUser(
    @Param('userId') userId: string,
    @Body('suspended') suspended: boolean,
  ) {
    return this.adminService.suspendUser(userId, suspended);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Delete a user and all related data' })
  async deleteUser(@Param('userId') userId: string) {
    return this.adminService.deleteUser(userId);
  }
}
