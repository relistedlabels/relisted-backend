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
  ApiBody,
  ApiCookieAuth,
  ApiResponse
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}
  @ApiCookieAuth('access_token')
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

  @ApiCookieAuth('access_token')
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

  @ApiCookieAuth('access_token')
  @Auth()
  @Get(':id')
  @ApiResponse({
    status: 200,
    description: ' User profile fetched successfully',
  })
  @ApiResponse({
    status: 501,
    description: 'internal server error',
  })
  findOne(@Param('id') id: string) {
    return this.profileService.findOne(id);
  }

  @ApiCookieAuth('access_token')
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

  @ApiCookieAuth('access_token')
  @Auth([Role.DRESSER])
  @Patch('verify/:id')
  @ApiResponse({
    status: 201,
    description: 'User profile verified successfully',
  })
  @ApiResponse({
    status: 501,
    description: 'internal server error',
  })
  verifyProfile(
    @Param('id') id: string,

    @AuthUser() user: userEntity,
  ) {
    return this.profileService.verifyProfile(id, user);
  }

  @ApiCookieAuth('access_token')
  @Auth()
  @Auth([Role.CURATOR])
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
