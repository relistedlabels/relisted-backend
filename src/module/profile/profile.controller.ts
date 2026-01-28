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
  ApiResponse
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { CreateProfileDto, upgradeProfile } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
@ApiBearerAuth('bearer')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}
  
  @Auth()
  @Post()
  @ApiBody({
    type: CreateProfileDto,
  })
  
  @ApiResponse({
    status: 201,
    description: 'Profile created successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  create(
    @Body() createProfileDto: CreateProfileDto,
    @AuthUser() user: userEntity,
  ) {
    return this.profileService.create(createProfileDto, user);
  }

  
  @Auth()
  @Get()
  @ApiResponse({
    status: 200,
    description: 'All users Profile fetched  successfully',
  })
  @ApiResponse({
    status: 501,
    description: 'internal server error',
  })

  findAll() {
    return this.profileService.findAll();
  }


  @Auth()
  @Get("user-profile")
  @ApiResponse({
    status: 200,
    description: ' User profile fetched successfully',
  })
  @ApiResponse({
    status: 501,
    description: 'internal server error',
  })
  findOne( @AuthUser() user: userEntity) {
    return this.profileService.findOne(user);
  }

 
  @Auth()
  @Auth()
  @Patch(':id')
  @ApiResponse({
    status: 201,
    description: 'User profile updated successfully',
  })
  @ApiResponse({
    status: 501,
    description: 'internal server error',
  })


  update(
    @Param('id') id: string,

    @Body() updateProfileDto: UpdateProfileDto,
    @AuthUser() user: userEntity,
  ) {
    return this.profileService.update(id, updateProfileDto, user);
  }


  @Patch(':profileId/upgrade-lister')
  @ApiOperation({ summary: 'Upgrade user profile to LISTER' })
  @ApiOkResponse({
    schema: {
      example: {
        message: 'User profile verified and role upgraded to LISTER successfully',
        data: {
          id: 'profile-id',
          user: {
            id: 'user-id',
            role: 'LISTER',
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Profile already verified or incomplete',
  })
  @ApiNotFoundResponse({
    description: 'Profile not found',
  })
  upgradeToLister(
    @Param('profileId') profileId: string,
    @AuthUser() user: userEntity,
    @Body() dto: upgradeProfile,
  ) {
    return this.profileService.upgradeProfileToLister(
      profileId,
      user,
      dto,
    );
  }
   
  @Auth()
  @Auth()
  @Patch(':id')
  @ApiResponse({
    status: 201,
    description: 'User profile updated successfully',
  })
  @ApiResponse({
    status: 501,
    description: 'internal server error',
  })



  @Auth()
  @Auth([Role.ADMIN])
  @Delete(":id")
  @ApiResponse({
    status: 200,
    description: ' User profile deleted successfully',
  })
  @ApiResponse({
    status: 501,
    description: 'internal server error',
  })

  remove(@Param("id") id:string) {
    return this.profileService.remove(id);
  }
}
