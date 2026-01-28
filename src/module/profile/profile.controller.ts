import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { CreateProfileDto, upgradeProfile } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /**
   * Create a new profile
   */
  @Auth()
  @Post()
  @ApiOperation({ summary: 'Create a new user profile' })
  @ApiBody({ type: CreateProfileDto })
  @ApiResponse({
    status: 201,
    description: 'Profile created successfully',
    schema: {
      example: {
        id: 'profile-uuid',
        userId: 'user-uuid',
        phoneNumber: '08012345678',
        isApproved: false,
        createdAt: '2026-01-28T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 501, description: 'Internal server error' })
  create(@Body() createProfileDto: CreateProfileDto, @AuthUser() user: userEntity) {
    return this.profileService.create(createProfileDto, user);
  }

  /**
   * Get all profiles
   */
  @Auth()
  @Get()
  @ApiOperation({ summary: 'Get all user profiles' })
  @ApiResponse({
    status: 200,
    description: 'All user profiles fetched successfully',
    schema: {
      example: [
        {
          id: 'profile-uuid',
          userId: 'user-uuid',
          phoneNumber: '08012345678',
          isApproved: true,
        },
      ],
    },
  })
  @ApiResponse({ status: 501, description: 'Internal server error' })
  findAll() {
    return this.profileService.findAll();
  }

  /**
   * Get profile of logged-in user
   */
  @Auth()
  @Get('user-profile')
  @ApiOperation({ summary: 'Get logged-in user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile fetched successfully',
    schema: {
      example: {
        id: 'profile-uuid',
        userId: 'user-uuid',
        phoneNumber: '08012345678',
        isApproved: true,
      },
    },
  })
  @ApiResponse({ status: 501, description: 'Internal server error' })
  findOne(@AuthUser() user: userEntity) {
    return this.profileService.findOne(user);
  }

  /**
   * Update user profile
   */
  @Auth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiParam({ name: 'id', description: 'Profile ID', example: 'profile-uuid' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({
    status: 201,
    description: 'User profile updated successfully',
    schema: {
      example: {
        id: 'profile-uuid',
        phoneNumber: '08012345678',
        isApproved: true,
        updatedAt: '2026-01-28T12:10:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 501, description: 'Internal server error' })
  update(
    @Param('id') id: string,
    @Body() updateProfileDto: UpdateProfileDto,
    @AuthUser() user: userEntity,
  ) {
    return this.profileService.update(id, updateProfileDto, user);
  }

  /**
   * Upgrade user profile to LISTER (Curator)
   */
  @Auth()
  @Patch(':profileId/upgrade-lister')
  @ApiOperation({ summary: 'Upgrade user profile to LISTER' })
  @ApiParam({ name: 'profileId', description: 'Profile ID', example: 'profile-uuid' })
  @ApiBody({ type: upgradeProfile })
  @ApiOkResponse({
    description: 'Profile upgraded to LISTER successfully',
    schema: {
      example: {
        message: 'User profile verified and role upgraded to LISTER successfully',
        data: {
          id: 'profile-uuid',
          user: {
            id: 'user-uuid',
            role: 'LISTER',
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Profile already verified or incomplete' })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  upgradeToLister(
    @Param('profileId') profileId: string,
    @AuthUser() user: userEntity,
    @Body() dto: upgradeProfile,
  ) {
    return this.profileService.upgradeProfileToLister(profileId, user, dto);
  }

  /**
   * Delete user profile (Admin only)
   */
  @Auth([Role.ADMIN])
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user profile (Admin only)' })
  @ApiParam({ name: 'id', description: 'Profile ID', example: 'profile-uuid' })
  @ApiOkResponse({
    description: 'User profile deleted successfully',
    schema: {
      example: { message: 'User profile deleted successfully' },
    },
  })
  @ApiResponse({ status: 501, description: 'Internal server error' })
  remove(@Param('id') id: string) {
    return this.profileService.remove(id);
  }
}
